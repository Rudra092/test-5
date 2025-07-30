const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage });

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// Schemas
const User = mongoose.model('User', new mongoose.Schema({
  username: String,
  password: String,
  email: String,
  fullname: String,
  phone: String,
  avatar: String,
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Message = mongoose.model('Message', new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String,
  file: String,
  createdAt: { type: Date, default: Date.now },
  seen: { type: Boolean, default: false }
}));

const FriendRequest = mongoose.model('FriendRequest', new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: 'pending' }
}));

const otps = {}; // OTP store

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 🔌 Socket.IO logic
let onlineUsers = {}; // { userId: socketId }

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('user-connected', (userId) => {
    onlineUsers[userId] = socket.id;
    console.log(`✅ User connected: ${userId}`);
    io.emit('online-users', Object.keys(onlineUsers));
  });

  socket.on('disconnect', () => {
    const disconnectedUser = Object.keys(onlineUsers).find(uid => onlineUsers[uid] === socket.id);
    if (disconnectedUser) {
      delete onlineUsers[disconnectedUser];
      io.emit('online-users', Object.keys(onlineUsers));
      console.log(`❌ User disconnected: ${disconnectedUser}`);
    }
  });

  socket.on('chat-message', async (msg) => {
    const message = new Message(msg);
    await message.save();

    const receiverSocket = onlineUsers[msg.to];
    const senderSocket = onlineUsers[msg.from];

    if (receiverSocket) {
      io.to(receiverSocket).emit('chat-message', message);
    }
    if (senderSocket) {
      io.to(senderSocket).emit('chat-message', message);
    }
  });

  socket.on('typing', ({ from, to }) => {
    const receiverSocket = onlineUsers[to];
    if (receiverSocket) {
      io.to(receiverSocket).emit('typing', { from });
    }
  });

  socket.on('seen', async ({ from, to }) => {
    await Message.updateMany({ from, to, seen: false }, { seen: true });

    const senderSocket = onlineUsers[from];
    if (senderSocket) {
      io.to(senderSocket).emit('seen', { from: to });
    }
  });
});

// Routes
app.post('/upload', upload.single('file'), (req, res) => {
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

app.post('/register', async (req, res) => {
  const { username, email, password, fullname, phone } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'All fields required' });
  }

  const exists = await User.findOne({ $or: [{ username }, { email }] });
  if (exists) return res.status(400).json({ success: false, message: 'User already exists' });

  const user = new User({ username, email, password, fullname, phone });
  await user.save();
  res.json({ success: true, message: 'Registered successfully!' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const found = await User.findOne({ username, password });
  if (found) {
    res.json({ success: true, message: 'Login successful!', user: found });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.post('/request-otp', async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otps[email] = otp;

  try {
    await transporter.sendMail({
      from: `"My App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset OTP',
      html: `<p>Your OTP is: <strong>${otp}</strong></p>`
    });
    res.json({ success: true, message: 'OTP sent' });
  } catch {
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
});

app.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (otps[email] === otp) {
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Invalid OTP' });
  }
});

app.post('/reset-password', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOneAndUpdate({ email }, { password });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  delete otps[email];
  res.json({ success: true, message: 'Password reset successfully' });
});

app.get('/me/:id', async (req, res) => {
  const user = await User.findById(req.params.id).populate('friends', 'fullname username avatar');
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, user });
});

app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone, avatar } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone, avatar }, { new: true });
  if (!user) return res.status(404).json({ success: false });
  res.json({ success: true, message: 'Profile updated', user });
});

app.get('/users', async (req, res) => {
  const users = await User.find({}, 'username fullname friends avatar');
  res.json(users);
});

app.post('/friend-request', async (req, res) => {
  const { from, to } = req.body;
  const exists = await FriendRequest.findOne({
    $or: [{ from, to }, { from: to, to: from }],
    status: 'pending'
  });
  if (exists) return res.status(400).json({ success: false, message: 'Request already exists' });

  await new FriendRequest({ from, to }).save();
  res.json({ success: true });
});

app.get('/friend-requests/:id', async (req, res) => {
  const requests = await FriendRequest.find({ to: req.params.id, status: 'pending' }).populate('from', 'fullname username avatar');
  res.json(requests);
});

app.get('/friend-requests/sent/:id', async (req, res) => {
  const requests = await FriendRequest.find({ from: req.params.id, status: 'pending' }).populate('to', 'fullname username avatar');
  res.json(requests);
});

app.post('/friend-request/accept', async (req, res) => {
  const { requestId } = req.body;
  const request = await FriendRequest.findById(requestId);
  if (!request) return res.status(404).json({ success: false });

  request.status = 'accepted';
  await request.save();

  const fromUser = await User.findById(request.from);
  const toUser = await User.findById(request.to);

  if (!fromUser.friends.includes(toUser._id)) fromUser.friends.push(toUser._id);
  if (!toUser.friends.includes(fromUser._id)) toUser.friends.push(fromUser._id);

  await fromUser.save();
  await toUser.save();

  res.json({ success: true });
});

app.get('/messages/:from/:to', async (req, res) => {
  const { from, to } = req.params;
  const messages = await Message.find({
    $or: [
      { from, to },
      { from: to, to: from }
    ]
  }).sort('createdAt');

  res.json(messages);
});

// ✅ Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
