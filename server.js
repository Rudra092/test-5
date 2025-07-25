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

// 🌐 MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// 📦 Schemas
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  email: String,
  fullname: String,
  phone: String,
  photo: String
});

const friendRequestSchema = new mongoose.Schema({
  from: String,
  to: String,
  status: { type: String, default: 'pending' }
});

const messageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,
  time: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const FriendRequest = mongoose.model('FriendRequest', friendRequestSchema);
const Message = mongoose.model('Message', messageSchema);

// 📧 Nodemailer
const otps = {};
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 🔐 Register
app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;
  if (!username || !email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

  const exists = await User.findOne({ $or: [{ username }, { email }] });
  if (exists) return res.status(400).json({ success: false, message: 'User exists' });

  const user = new User({ username, email, password, fullname, phone });
  await user.save();
  res.json({ success: true, message: 'Registered successfully' });
});

// 🔑 Login
app.post('/login', async (req, res) => {
  const user = await User.findOne({ username: req.body.username, password: req.body.password });
  if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  res.json({ success: true, user });
});

// 📧 OTP
app.post('/request-otp', async (req, res) => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[req.body.email] = otp;

  try {
    await transporter.sendMail({
      from: `"Soulmate App" <${process.env.EMAIL_USER}>`,
      to: req.body.email,
      subject: 'Your OTP',
      html: `<p>Your OTP is <strong>${otp}</strong></p>`
    });
    res.json({ success: true, message: 'OTP sent' });
  } catch {
    res.status(500).json({ success: false, message: 'Email send failed' });
  }
});

app.post('/verify-otp', (req, res) => {
  res.json({ success: otps[req.body.email] === req.body.otp });
});

app.post('/reset-password', async (req, res) => {
  const user = await User.findOneAndUpdate({ email: req.body.email }, { password: req.body.password });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  delete otps[req.body.email];
  res.json({ success: true });
});

// 📄 Profile
app.get('/me/:id', async (req, res) => {
  const user = await User.findById(req.params.id, '-password');
  if (!user) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, user });
});

app.put('/update-profile/:id', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, user });
});

// 🖼️ Upload Photo (stub)
app.post('/upload-photo/:id', (req, res) => {
  res.json({ success: true, url: 'https://via.placeholder.com/100?text=Uploaded' });
});

// 🔍 Search Users
app.get('/search', async (req, res) => {
  const users = await User.find({
    username: { $regex: req.query.q, $options: 'i' },
    _id: { $ne: req.query.exclude }
  }).limit(10);
  res.json(users);
});

// 🤝 Friend Request
app.post('/friend-request', async (req, res) => {
  const { from, to } = req.body;
  const existing = await FriendRequest.findOne({ from, to });
  if (existing) return res.status(400).json({ success: false, message: 'Already requested' });

  await new FriendRequest({ from, to }).save();
  res.json({ success: true });
});

app.post('/accept-request', async (req, res) => {
  const request = await FriendRequest.findOneAndUpdate({ from: req.body.from, to: req.body.to }, { status: 'accepted' });
  if (!request) return res.status(404).json({ success: false });
  res.json({ success: true });
});

app.get('/requests/:id', async (req, res) => {
  const requests = await FriendRequest.find({ to: req.params.id, status: 'pending' }).populate('from');
  res.json(requests);
});

app.get('/friends/:id', async (req, res) => {
  const friends = await FriendRequest.find({ $or: [
    { from: req.params.id, status: 'accepted' },
    { to: req.params.id, status: 'accepted' }
  ] });

  const friendIds = friends.map(f => f.from === req.params.id ? f.to : f.from);
  const users = await User.find({ _id: { $in: friendIds } });
  res.json(users);
});

// 💬 Chat
app.post('/message', async (req, res) => {
  const msg = new Message(req.body);
  await msg.save();
  res.json({ success: true });
});

app.get('/messages/:user1/:user2', async (req, res) => {
  const messages = await Message.find({
    $or: [
      { from: req.params.user1, to: req.params.user2 },
      { from: req.params.user2, to: req.params.user1 }
    ]
  }).sort({ time: 1 });
  res.json({ messages });
});

app.get('/chats/:id', async (req, res) => {
  const friends = await FriendRequest.find({ 
    $or: [{ from: req.params.id }, { to: req.params.id }],
    status: 'accepted'
  });

  const chatList = await Promise.all(friends.map(async f => {
    const friendId = f.from === req.params.id ? f.to : f.from;
    const lastMessage = await Message.findOne({ 
      $or: [
        { from: req.params.id, to: friendId },
        { from: friendId, to: req.params.id }
      ]
    }).sort({ time: -1 });

    const friend = await User.findById(friendId);
    return { friend, lastMessage: lastMessage?.text };
  }));

  res.json({ chats: chatList });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
