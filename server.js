// server.js
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// MODELS
const User = mongoose.model('User', new mongoose.Schema({
  username: String,
  password: String,
  email: String,
  fullname: String,
  phone: String,
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const FriendRequest = mongoose.model('FriendRequest', new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  senderId: String,
  receiverId: String,
  text: String,
  createdAt: { type: Date, default: Date.now }
}));

const otps = {};
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

let onlineUsers = {};
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  socket.on('user-connected', (user) => {
    onlineUsers[socket.id] = user;
    io.emit('online-users', Object.values(onlineUsers));
  });
  socket.on('chat-message', (msg) => {
    io.emit('chat-message', msg);
  });
  socket.on('send-message', ({ senderId, receiverId, text }) => {
    io.to(receiverId).emit('receive-message', { senderId, text });
  });
  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    io.emit('online-users', Object.values(onlineUsers));
  });
});

// AUTH
app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;
  if (!username || !email || !password) return res.status(400).json({ success: false, message: 'All fields are required.' });
  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) return res.status(400).json({ success: false, message: 'User already exists' });
  const user = new User({ username, email, password, fullname, phone });
  await user.save();
  res.json({ success: true, message: 'Registered successfully!' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const found = await User.findOne({ username, password });
    if (found) res.json({ success: true, message: 'Login successful!', user: found });
    else res.status(401).json({ success: false, message: 'Invalid credentials' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// OTP FLOW
app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email] = otp;
  try {
    await transporter.sendMail({
      from: `App <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'OTP for Password Reset',
      html: `<p>Your OTP is: <strong>${otp}</strong></p>`
    });
    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (otps[email] === otp) res.json({ success: true });
  else res.json({ success: false, message: 'Invalid OTP' });
});

app.post('/reset-password', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOneAndUpdate({ email }, { password });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    delete otps[email];
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

// USER PROFILE
app.get('/me/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id, '-password').populate('friends', 'username fullname');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone } = req.body;
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'Profile updated!', user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

// FRIEND REQUEST SYSTEM
app.post('/friend-request', async (req, res) => {
  const { from, to } = req.body;
  const exists = await FriendRequest.findOne({ from, to });
  if (exists) return res.status(400).json({ message: 'Already sent' });
  await FriendRequest.create({ from, to });
  res.json({ success: true });
});

app.get('/friend-requests/:userId', async (req, res) => {
  const requests = await FriendRequest.find({ to: req.params.userId }).populate('from', 'fullname username');
  res.json(requests);
});

app.post('/friend-request/accept', async (req, res) => {
  const { requestId } = req.body;
  const request = await FriendRequest.findById(requestId);
  if (!request) return res.status(404).json({ message: 'Request not found' });
  await User.findByIdAndUpdate(request.from, { $addToSet: { friends: request.to } });
  await User.findByIdAndUpdate(request.to, { $addToSet: { friends: request.from } });
  await FriendRequest.findByIdAndDelete(requestId);
  res.json({ success: true });
});

// CHAT
app.post('/messages', async (req, res) => {
  const { senderId, receiverId, text } = req.body;
  const message = await Message.create({ senderId, receiverId, text });
  res.json(message);
});

app.get('/messages/:userId/:friendId', async (req, res) => {
  const { userId, friendId } = req.params;
  const messages = await Message.find({
    $or: [
      { senderId: userId, receiverId: friendId },
      { senderId: friendId, receiverId: userId }
    ]
  }).sort('createdAt');
  res.json(messages);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running with socket.io on port ${PORT}`));
