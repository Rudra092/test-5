const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ✅ MongoDB Setup
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection failed:', err));

// ✅ Mongoose Schemas
const Message = mongoose.model('Message', new mongoose.Schema({
  from: String,
  to: String,
  text: String,
  createdAt: { type: Date, default: Date.now },
  seen: { type: Boolean, default: false },
  seenAt: Date
}));

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
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: 'pending' }
}));

const otps = {};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ✅ Real-time Logic
const onlineUsers = {};

io.on('connection', (socket) => {
  console.log(`📡 Socket connected: ${socket.id}`);

  socket.on('user-connected', (userId) => {
    onlineUsers[userId] = socket.id;
    io.emit('online-users', Object.keys(onlineUsers));
  });

  socket.on('disconnect', () => {
    const disconnectedUser = Object.keys(onlineUsers).find(uid => onlineUsers[uid] === socket.id);
    if (disconnectedUser) {
      delete onlineUsers[disconnectedUser];
      io.emit('online-users', Object.keys(onlineUsers));
    }
  });

  socket.on('chat-message', async (msg) => {
    const message = new Message({ ...msg, createdAt: new Date() });
    await message.save();
    const receiver = onlineUsers[msg.to];
    if (receiver) io.to(receiver).emit('chat-message', message);
    const sender = onlineUsers[msg.from];
    if (sender) io.to(sender).emit('chat-message', message);
  });

  socket.on('seen-message', async ({ messageId, from, to }) => {
    const seenAt = new Date();
    const updated = await Message.findByIdAndUpdate(messageId, { seen: true, seenAt }, { new: true });
    if (updated && onlineUsers[from]) {
      io.to(onlineUsers[from]).emit('message-seen', {
        messageId,
        seenAt
      });
    }
  });

  socket.on('typing', ({ from, to }) => {
    const receiver = onlineUsers[to];
    if (receiver) io.to(receiver).emit('typing', { from, to });
  });

  socket.on('stop-typing', ({ from, to }) => {
    const receiver = onlineUsers[to];
    if (receiver) io.to(receiver).emit('stop-typing', { from, to });
  });
});

// ✅ Routes
app.get('/messages/:from/:to', async (req, res) => {
  const { from, to } = req.params;
  const messages = await Message.find({
    $or: [{ from, to }, { from: to, to: from }]
  }).sort({ createdAt: 1 });
  res.json(messages);
});

app.get('/me/:id', async (req, res) => {
  const user = await User.findById(req.params.id).populate('friends', 'fullname username');
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, user });
});

// ✅ Register/Login/OTP
app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;
  const exists = await User.findOne({ $or: [{ username }, { email }] });
  if (exists) return res.status(400).json({ success: false, message: 'User already exists' });
  const user = await new User({ username, email, password, fullname, phone }).save();
  res.json({ success: true, user });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, password });
  if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
  res.json({ success: true, user });
});

app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email] = otp;
  await transporter.sendMail({
    from: `"My App" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'OTP',
    html: `<p>Your OTP is <strong>${otp}</strong></p>`
  });
  res.json({ success: true, message: 'OTP sent' });
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
  res.json({ success: true });
});

// ✅ Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
