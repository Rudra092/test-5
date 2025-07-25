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
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB error:', err));

// 📦 User Schema
const User = mongoose.model('User', new mongoose.Schema({
  username: String,
  password: String,
  email: String,
  fullname: String,
  phone: String,
  photo: String
}));

// In-memory OTP store (for demo only)
const otps = {};

// 📧 Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 🔐 REGISTER
app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Required fields missing' });
  }

  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    return res.status(400).json({ success: false, message: 'User already exists' });
  }

  const user = new User({ username, email, password, fullname, phone });
  await user.save();
  res.json({ success: true, message: 'Registered successfully!' });
});

// 🔐 LOGIN
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const found = await User.findOne({ username, password });
    if (found) {
      res.json({ success: true, message: 'Login successful!', user: found });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// 📧 Request OTP
app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email] = otp;

  try {
    await transporter.sendMail({
      from: `"Soulmate App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your OTP',
      html: `<p>Your OTP is <strong>${otp}</strong></p>`
    });
    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

// ✅ Verify OTP
app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (otps[email] === otp) {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Invalid OTP' });
  }
});

// 🔁 Reset Password
app.post('/reset-password', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOneAndUpdate({ email }, { password });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    delete otps[email];
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Reset failed' });
  }
});

// 👤 Get Profile
app.get('/me/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id, '-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching user' });
  }
});

// 📝 Update Profile
app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone } = req.body;
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'Profile updated', user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

// 📸 Upload Photo (Stub route – implementation optional)
app.post('/upload-photo/:id', async (req, res) => {
  res.json({ success: true, url: 'https://via.placeholder.com/100?text=Uploaded' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
