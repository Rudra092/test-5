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
  cors: { origin: '*' }
});

app.use(cors({ origin: '*' }));
app.use(express.json());

let onlineUsers = {};

// 📡 SOCKET.IO
io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);
  socket.on('user-connected', (user) => {
    onlineUsers[socket.id] = user;
    io.emit('online-users', Object.values(onlineUsers));
  });
  socket.on('chat-message', (msg) => {
    io.emit('chat-message', msg);
  });
  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    io.emit('online-users', Object.values(onlineUsers));
  });
});

// 🌐 MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB error:', err));

// 📦 Schemas
const User = mongoose.model('User', new mongoose.Schema({
  username: String,
  password: String,
  email: String,
  fullname: String,
  phone: String,
  photo: String
}));

const FriendRequest = mongoose.model('FriendRequest', new mongoose.Schema({
  from: String, // user ID
  to: String    // user ID
}));

const Friendship = mongoose.model('Friendship', new mongoose.Schema({
  user1: String,
  user2: String
}));

// OTP store (demo)
const otps = {};

// 📧 Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 🔐 Register/Login/OTP routes
app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;
  if (!username || !email || !password) return res.status(400).json({ success: false, message: 'Required fields missing' });
  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) return res.status(400).json({ success: false, message: 'User already exists' });
  const user = new User({ username, email, password, fullname, phone });
  await user.save();
  res.json({ success: true, message: 'Registered successfully!' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const found = await User.findOne({ username, password });
  if (found) res.json({ success: true, message: 'Login successful!', user: found });
  else res.status(401).json({ success: false, message: 'Invalid credentials' });
});

app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email] = otp;
  await transporter.sendMail({
    from: `"Soulmate App" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Your OTP',
    html: `<p>Your OTP is <strong>${otp}</strong></p>`
  });
  res.json({ success: true, message: 'OTP sent to email' });
});

app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (otps[email] === otp) res.json({ success: true });
  else res.json({ success: false, message: 'Invalid OTP' });
});

app.post('/reset-password', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOneAndUpdate({ email }, { password });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  delete otps[email];
  res.json({ success: true, message: 'Password reset successfully' });
});

// 🧑‍ Profile
app.get('/me/:id', async (req, res) => {
  const user = await User.findById(req.params.id, '-password');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, user });
});

app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone }, { new: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, message: 'Profile updated', user });
});

app.post('/upload-photo/:id', async (req, res) => {
  res.json({ success: true, url: 'https://via.placeholder.com/100?text=Uploaded' });
});

// 🔎 Search
app.get('/search', async (req, res) => {
  const { q, exclude } = req.query;
  if (!q) return res.json([]);
  const users = await User.find({
    username: { $regex: q, $options: 'i' },
    _id: { $ne: exclude }
  }).limit(10);
  res.json(users);
});

// 👥 Friend Requests
app.post('/send-request', async (req, res) => {
  const { from, to } = req.body;
  const exists = await FriendRequest.findOne({ from, to });
  if (exists) return res.json({ success: false, message: 'Request already sent' });
  await new FriendRequest({ from, to }).save();
  res.json({ success: true, message: 'Friend request sent' });
});

app.get('/requests/:userId', async (req, res) => {
  const requests = await FriendRequest.find({ to: req.params.userId }).populate('from');
  res.json(requests);
});

app.post('/accept-request', async (req, res) => {
  const { from, to } = req.body;
  await FriendRequest.deleteOne({ from, to });
  await new Friendship({ user1: from, user2: to }).save();
  res.json({ success: true, message: 'Friend request accepted' });
});

app.get('/friends/:userId', async (req, res) => {
  const friendships = await Friendship.find({
    $or: [{ user1: req.params.userId }, { user2: req.params.userId }]
  });

  const friendIds = friendships.map(f => f.user1 === req.params.userId ? f.user2 : f.user1);
  const friends = await User.find({ _id: { $in: friendIds } });
  res.json(friends);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
