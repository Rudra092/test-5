const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

mongoose.connect('your-mongodb-connection-string', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  phone: String,
  fullname: String,
  photo: String,
  requests: [String], // user IDs who sent requests
  friends: [String],  // accepted friend IDs
});

const User = mongoose.model('User', userSchema);

// Registration
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) return res.json({ success: false, message: 'User already exists' });

  const user = await User.create({ username, email, password });
  res.json({ success: true, user });
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email, password });
  if (!user) return res.json({ success: false, message: 'Invalid credentials' });
  res.json({ success: true, user });
});

// Update profile
app.put('/update-profile/:id', async (req, res) => {
  const { fullname, email, phone } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { fullname, email, phone }, { new: true });
  res.json({ success: true, user });
});

// Upload photo
const upload = multer({ dest: 'uploads/' });
app.post('/upload-photo/:id', upload.single('photo'), async (req, res) => {
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  const user = await User.findByIdAndUpdate(req.params.id, { photo: url }, { new: true });
  res.json({ success: true, url });
});

// Search users
app.get('/search-users', async (req, res) => {
  const query = req.query.query || '';
  const users = await User.find({ username: { $regex: query, $options: 'i' } });
  res.json(users);
});

// Send friend request
app.post('/send-request', async (req, res) => {
  const { from, to } = req.body;
  const recipient = await User.findById(to);
  if (!recipient.requests.includes(from)) {
    recipient.requests.push(from);
    await recipient.save();
  }
  res.json({ message: 'Friend request sent' });
});

// Get incoming requests
app.get('/incoming-requests/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  const requestUsers = await User.find({ _id: { $in: user.requests } });
  res.json(requestUsers);
});

// Accept friend request
app.post('/accept-request', async (req, res) => {
  const { from, to } = req.body;
  const sender = await User.findById(from);
  const receiver = await User.findById(to);

  if (!sender.friends.includes(to)) sender.friends.push(to);
  if (!receiver.friends.includes(from)) receiver.friends.push(from);
  receiver.requests = receiver.requests.filter(id => id !== from);

  await sender.save();
  await receiver.save();

  res.json({ message: 'Friend request accepted' });
});

// Friend suggestions
app.get('/suggestions/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  const others = await User.find({ _id: { $ne: user._id } });

  const suggestions = others
    .filter(other =>
      !user.friends.includes(other._id.toString()) &&
      !user.requests.includes(other._id.toString()) &&
      !other.requests.includes(user._id.toString())
    )
    .map(other => ({
      _id: other._id,
      username: other.username,
      mutual: other.friends.filter(fid => user.friends.includes(fid)).length
    }));

  res.json(suggestions);
});

// ✅ Get list of friends
app.get('/friends/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  const friends = await User.find({ _id: { $in: user.friends } });
  res.json(friends);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server started on port', PORT));
