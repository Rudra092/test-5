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

app.use(cors());
app.use(express.json());

// In-memory OTP storage
const otps = {};

// MongoDB models
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  fullname: String,
  phone: String,
  photo: String,
  friends: [String],
  requests: [String]
});

const User = mongoose.model('User', userSchema);

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// SOCKET.IO HANDLER
let onlineUsers = {};
io.on('connection', socket => {
  socket.on('user-connected', user => {
    onlineUsers[socket.id] = user;
    io.emit('online-users', Object.values(onlineUsers));
  });

  socket.on('chat-message', msg => {
    io.emit('chat-message', msg);
  });

  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    io.emit('online-users', Object.values(onlineUsers));
  });
});

// AUTH ROUTES
app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;
  const exists = await User.findOne({ $or: [{ username }, { email }] });
  if (exists) return res.status(400).json({ success: false, message: 'User already exists' });

  const user = new User({ username, email, password, fullname, phone, friends: [], requests: [] });
  await user.save();
  res.json({ success: true, user });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, password });
  if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  res.json({ success: true, user });
});

// OTP
app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email] = otp;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your OTP',
    html: `<p>Your OTP is: <strong>${otp}</strong></p>`
  });
  res.json({ success: true });
});

app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (otps[email] === otp) {
    delete otps[email];
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

app.post('/reset-password', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOneAndUpdate({ email }, { password });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true });
});

// PROFILE
app.get('/me/:id', async (req, res) => {
  const user = await User.findById(req.params.id, '-password');
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, user });
});

app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone }, { new: true });
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, user });
});

app.post('/upload-photo/:id', async (req, res) => {
  // You can integrate Cloudinary or other services here
  res.json({ success: true, url: 'https://via.placeholder.com/100?text=Uploaded' });
});

// 🔍 SEARCH USERS
app.get('/search-users', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  const users = await User.find({ username: { $regex: query, $options: 'i' } }, 'username _id');
  res.json(users);
});

// 🤝 SEND REQUEST
app.post('/send-request', async (req, res) => {
  const { from, to } = req.body;
  const toUser = await User.findById(to);
  if (!toUser.requests.includes(from) && !toUser.friends.includes(from)) {
    toUser.requests.push(from);
    await toUser.save();
  }
  res.json({ success: true, message: 'Request sent' });
});

// 📥 INCOMING REQUESTS
app.get('/incoming-requests/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  const users = await User.find({ _id: { $in: user.requests } }, 'username _id');
  res.json(users);
});

// ✅ ACCEPT REQUEST
app.post('/accept-request', async (req, res) => {
  const { from, to } = req.body;
  const toUser = await User.findById(to);
  const fromUser = await User.findById(from);

  if (!toUser.friends.includes(from)) toUser.friends.push(from);
  if (!fromUser.friends.includes(to)) fromUser.friends.push(to);

  toUser.requests = toUser.requests.filter(r => r !== from);
  await toUser.save();
  await fromUser.save();

  res.json({ success: true, message: 'Friend added' });
});

// 🧠 FRIEND SUGGESTIONS
app.get('/suggestions/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  const all = await User.find({ _id: { $ne: user._id } });
  const suggestions = all.filter(u => !user.friends.includes(u._id.toString()) && !user.requests.includes(u._id.toString()));
  res.json(suggestions.map(u => ({ _id: u._id, username: u.username })));
});

// START
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
