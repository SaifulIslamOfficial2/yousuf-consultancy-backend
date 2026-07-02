import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';

// ---------------------------------------------------------------
// Cloudinary (optional). If CLOUDINARY_URL is set, uploads go there;
// otherwise images are stored as base64 data URIs in MongoDB.
// ---------------------------------------------------------------
const USE_CLOUDINARY = !!process.env.CLOUDINARY_URL;
if (USE_CLOUDINARY) {
  // CLOUDINARY_URL takes precedence and configures the SDK automatically
  cloudinary.config({ secure: true });
}

const uploadImage = async (buffer, mimetype) => {
  if (USE_CLOUDINARY) {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { folder: 'yousuf-consultancy', resource_type: 'image' },
          (err, result) => (err ? reject(err) : resolve(result.secure_url))
        )
        .end(buffer);
    });
  }
  return `data:${mimetype};base64,${buffer.toString('base64')}`;
};

const deleteImage = async (url) => {
  if (!url || !USE_CLOUDINARY) return;
  // Only attempt deletion for Cloudinary-hosted assets
  if (!url.includes('res.cloudinary.com')) return;
  try {
    // extract public_id: .../yousuf-consultancy/xxxxx.jpg -> yousuf-consultancy/xxxxx
    const match = url.match(/\/upload\/(?:v\d+\/)?([^.]+)/);
    if (match) await cloudinary.uploader.destroy(match[1]);
  } catch {
    /* ignore */
  }
};

// ---------------------------------------------------------------
// Multer — memory storage (works in serverless because no disk write)
// ---------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('শুধুমাত্র ছবি আপলোড করা যাবে'), false);
  },
  limits: { fileSize: 8 * 1024 * 1024 },
});

// ---------------------------------------------------------------
// Models
// ---------------------------------------------------------------
const ALL_PERMISSIONS = [
  'team',
  'services',
  'blog',
  'umrah',
  'gallery',
  'applications',
  'analytics',
  'website',
];

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'sub_admin'], default: 'sub_admin' },
    permissions: { type: [String], default: [] },
    avatar: { type: String, default: '' },
    phone: { type: String, default: '' },
  },
  { timestamps: true }
);

const applicationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: String,
    service: String,
    message: String,
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'approved', 'rejected'],
      default: 'pending',
    },
    notes: String,
  },
  { timestamps: true }
);

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    position: { type: String, required: true },
    bio: String,
    image: String,
    email: String,
    phone: String,
    experience: String,
    socialLinks: {
      facebook: String,
      linkedin: String,
      twitter: String,
      whatsapp: String,
    },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const umrahSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    price: { type: Number, default: 0 },
    duration: String,
    flightType: { type: String, enum: ['direct', 'transit'], default: 'direct' },
    includes: [String],
    image: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    excerpt: String,
    content: { type: String, required: true },
    image: String,
    category: { type: String, default: 'সাধারণ' },
    author: String,
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    shortDescription: String,
    image: String,
    category: { type: String, default: 'সাধারণ' },
    price: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const gallerySchema = new mongoose.Schema(
  {
    title: String,
    image: { type: String, required: true },
    description: String,
    category: { type: String, default: 'সাধারণ' },
  },
  { timestamps: true }
);

// Avoid OverwriteModelError when serverless function is re-invoked
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);
const Admin = model('Admin', adminSchema);
const Application = model('Application', applicationSchema);
const TeamMember = model('TeamMember', teamSchema);
const UmrahPackage = model('UmrahPackage', umrahSchema);
const BlogPost = model('BlogPost', blogSchema);
const Service = model('Service', serviceSchema);
const Gallery = model('Gallery', gallerySchema);

// ---------------------------------------------------------------
// MongoDB connection (cached across serverless invocations)
// ---------------------------------------------------------------
let connectingPromise = null;
let initialized = false;

export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set');
  }
  // Reuse an in-flight connect promise; otherwise start a new one
  if (!connectingPromise) {
    connectingPromise = mongoose
      .connect(process.env.MONGODB_URI, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 10000,
      })
      .catch((err) => {
        // Reset so the next request gets a fresh attempt
        connectingPromise = null;
        throw err;
      });
  }
  await connectingPromise;

  if (!initialized) {
    await ensureDefaultAdmin();
    initialized = true;
  }
  return mongoose.connection;
}

async function ensureDefaultAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'yousufconsultancy46@gmail.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '0571446@#';
  const existing = await Admin.findOne({ email });
  if (!existing) {
    const hashed = await bcrypt.hash(password, 10);
    await Admin.create({
      name: 'Yousuf Admin',
      email,
      password: hashed,
      role: 'admin',
      permissions: ALL_PERMISSIONS,
    });
    console.log(`Default admin created (${email})`);
  } else if (existing.role !== 'admin' || existing.permissions.length < ALL_PERMISSIONS.length) {
    existing.role = 'admin';
    existing.permissions = ALL_PERMISSIONS;
    await existing.save();
  }
}

// ---------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------
const isAuthenticated = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'টোকেন প্রয়োজন' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id).select('-password');
    if (!admin) return res.status(401).json({ error: 'অ্যাডমিন পাওয়া যায়নি' });
    req.user = admin;
    next();
  } catch {
    return res.status(401).json({ error: 'অবৈধ টোকেন' });
  }
};

const isSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'শুধুমাত্র প্রধান অ্যাডমিন অনুমোদিত' });
  }
  next();
};

const hasPermission = (perm) => (req, res, next) => {
  if (req.user.role === 'admin') return next();
  if (!req.user.permissions?.includes(perm)) {
    return res.status(403).json({ error: 'এই অপারেশনের জন্য অনুমতি নেই' });
  }
  next();
};

// Wraps async route handlers and forwards errors
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Connect to DB before any /api request (cached after first call)
const ensureDB = async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (e) {
    res.status(500).json({ error: 'ডাটাবেস সংযোগ ব্যর্থ', detail: e.message });
  }
};

// ---------------------------------------------------------------
// Build the Express app
// ---------------------------------------------------------------
export function createApp() {
  const app = express();

  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow same-origin / server-to-server / curl (no Origin header)
        if (!origin) return cb(null, true);
        // Wildcard if not configured (also handles Vercel preview URLs)
        if (allowedOrigins.length === 0) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        // Allow any *.vercel.app preview
        if (/\.vercel\.app$/.test(new URL(origin).hostname)) return cb(null, true);
        return cb(new Error('CORS not allowed'));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ limit: '20mb', extended: true }));

  // Health check (no DB required)
  app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

  // From here on, /api requests need the database
  app.use('/api', ensureDB);

  // ---------- Auth ----------
  app.post(
    '/api/auth/login',
    wrap(async (req, res) => {
      const { email, password } = req.body;
      if (!email || !password)
        return res.status(400).json({ error: 'ইমেইল এবং পাসওয়ার্ড প্রয়োজন' });
      const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
      if (!admin) return res.status(401).json({ error: 'ভুল ইমেইল বা পাসওয়ার্ড' });
      const valid = await bcrypt.compare(password, admin.password);
      if (!valid) return res.status(401).json({ error: 'ভুল ইমেইল বা পাসওয়ার্ড' });
      const token = jwt.sign(
        { id: admin._id, email: admin.email, role: admin.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({
        success: true,
        token,
        user: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          avatar: admin.avatar,
          phone: admin.phone,
        },
      });
    })
  );

  app.get('/api/auth/me', isAuthenticated, (req, res) =>
    res.json({
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      permissions: req.user.permissions,
      avatar: req.user.avatar,
      phone: req.user.phone,
    })
  );

  // ---------- Admin profile ----------
  app.put(
    '/api/admin/profile',
    isAuthenticated,
    wrap(async (req, res) => {
      const { name, email, phone } = req.body;
      const updates = {};
      if (name) updates.name = name.trim();
      if (email) updates.email = email.toLowerCase().trim();
      if (phone !== undefined) updates.phone = phone;
      if (updates.email && updates.email !== req.user.email) {
        const exists = await Admin.findOne({ email: updates.email });
        if (exists) return res.status(400).json({ error: 'এই ইমেইল ইতিমধ্যে ব্যবহৃত' });
      }
      const admin = await Admin.findByIdAndUpdate(req.user._id, updates, {
        new: true,
      }).select('-password');
      res.json({ success: true, user: admin, message: 'প্রোফাইল আপডেট হয়েছে' });
    })
  );

  app.post(
    '/api/admin/avatar',
    isAuthenticated,
    upload.single('avatar'),
    wrap(async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'ছবি প্রয়োজন' });
      const url = await uploadImage(req.file.buffer, req.file.mimetype);
      if (req.user.avatar) await deleteImage(req.user.avatar);
      const admin = await Admin.findByIdAndUpdate(
        req.user._id,
        { avatar: url },
        { new: true }
      ).select('-password');
      res.json({ success: true, avatar: url, user: admin });
    })
  );

  app.post(
    '/api/admin/change-password',
    isAuthenticated,
    wrap(async (req, res) => {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword)
        return res.status(400).json({ error: 'সকল ফিল্ড প্রয়োজন' });
      if (newPassword.length < 6)
        return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
      const admin = await Admin.findById(req.user._id);
      const valid = await bcrypt.compare(currentPassword, admin.password);
      if (!valid) return res.status(401).json({ error: 'বর্তমান পাসওয়ার্ড সঠিক নয়' });
      admin.password = await bcrypt.hash(newPassword, 10);
      await admin.save();
      res.json({ success: true, message: 'পাসওয়ার্ড পরিবর্তিত হয়েছে' });
    })
  );

  // ---------- Sub-admin management ----------
  app.get(
    '/api/admins',
    isAuthenticated,
    isSuperAdmin,
    wrap(async (req, res) => {
      const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
      res.json(admins);
    })
  );

  app.post(
    '/api/admins',
    isAuthenticated,
    isSuperAdmin,
    wrap(async (req, res) => {
      const { name, email, password, permissions } = req.body;
      if (!name || !email || !password)
        return res.status(400).json({ error: 'নাম, ইমেইল এবং পাসওয়ার্ড প্রয়োজন' });
      if (password.length < 6)
        return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষর হতে হবে' });
      const exists = await Admin.findOne({ email: email.toLowerCase().trim() });
      if (exists) return res.status(400).json({ error: 'এই ইমেইল ইতিমধ্যে ব্যবহৃত' });
      const hashed = await bcrypt.hash(password, 10);
      const admin = await Admin.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashed,
        role: 'sub_admin',
        permissions: Array.isArray(permissions) ? permissions : [],
      });
      const safe = admin.toObject();
      delete safe.password;
      res.json({ success: true, admin: safe });
    })
  );

  app.put(
    '/api/admins/:id',
    isAuthenticated,
    isSuperAdmin,
    wrap(async (req, res) => {
      const { name, permissions } = req.body;
      const target = await Admin.findById(req.params.id);
      if (!target) return res.status(404).json({ error: 'অ্যাডমিন পাওয়া যায়নি' });
      if (target.role === 'admin')
        return res.status(400).json({ error: 'প্রধান অ্যাডমিন পরিবর্তন করা যাবে না' });
      if (name) target.name = name.trim();
      if (Array.isArray(permissions)) target.permissions = permissions;
      await target.save();
      res.json({ success: true, admin: target });
    })
  );

  app.delete(
    '/api/admins/:id',
    isAuthenticated,
    isSuperAdmin,
    wrap(async (req, res) => {
      const target = await Admin.findById(req.params.id);
      if (!target) return res.status(404).json({ error: 'পাওয়া যায়নি' });
      if (target.role === 'admin')
        return res.status(400).json({ error: 'প্রধান অ্যাডমিন মুছে ফেলা যাবে না' });
      await target.deleteOne();
      res.json({ success: true, message: 'মুছে ফেলা হয়েছে' });
    })
  );

  // ---------- Team ----------
  app.get(
    '/api/team',
    wrap(async (req, res) => {
      const team = await TeamMember.find().sort({ order: 1, createdAt: -1 });
      res.json(team);
    })
  );

  app.post(
    '/api/team',
    isAuthenticated,
    hasPermission('team'),
    upload.single('image'),
    wrap(async (req, res) => {
      const body = { ...req.body };
      if (typeof body.socialLinks === 'string') {
        try {
          body.socialLinks = JSON.parse(body.socialLinks);
        } catch {
          body.socialLinks = {};
        }
      }
      if (req.file) body.image = await uploadImage(req.file.buffer, req.file.mimetype);
      const member = await TeamMember.create(body);
      res.json({ success: true, member, message: 'টিম সদস্য যোগ হয়েছে' });
    })
  );

  app.put(
    '/api/team/:id',
    isAuthenticated,
    hasPermission('team'),
    upload.single('image'),
    wrap(async (req, res) => {
      const body = { ...req.body };
      if (typeof body.socialLinks === 'string') {
        try {
          body.socialLinks = JSON.parse(body.socialLinks);
        } catch {
          body.socialLinks = {};
        }
      }
      const old = await TeamMember.findById(req.params.id);
      if (!old) return res.status(404).json({ error: 'সদস্য পাওয়া যায়নি' });
      if (req.file) {
        if (old.image) await deleteImage(old.image);
        body.image = await uploadImage(req.file.buffer, req.file.mimetype);
      }
      const member = await TeamMember.findByIdAndUpdate(req.params.id, body, { new: true });
      res.json({ success: true, member, message: 'টিম সদস্য আপডেট হয়েছে' });
    })
  );

  app.delete(
    '/api/team/:id',
    isAuthenticated,
    hasPermission('team'),
    wrap(async (req, res) => {
      const m = await TeamMember.findById(req.params.id);
      if (!m) return res.status(404).json({ error: 'সদস্য পাওয়া যায়নি' });
      if (m.image) await deleteImage(m.image);
      await m.deleteOne();
      res.json({ success: true, message: 'টিম সদস্য মুছে দেওয়া হয়েছে' });
    })
  );

  // ---------- Umrah packages ----------
  app.get(
    '/api/umrah',
    wrap(async (req, res) => {
      const list = await UmrahPackage.find().sort({ createdAt: -1 });
      res.json(list);
    })
  );

  app.post(
    '/api/umrah',
    isAuthenticated,
    hasPermission('umrah'),
    upload.single('image'),
    wrap(async (req, res) => {
      const body = { ...req.body };
      if (typeof body.includes === 'string') {
        try {
          body.includes = JSON.parse(body.includes);
        } catch {
          body.includes = [];
        }
      }
      if (typeof body.isActive === 'string') body.isActive = body.isActive === 'true';
      if (req.file) body.image = await uploadImage(req.file.buffer, req.file.mimetype);
      const pkg = await UmrahPackage.create(body);
      res.json({ success: true, package: pkg, message: 'প্যাকেজ যোগ হয়েছে' });
    })
  );

  app.put(
    '/api/umrah/:id',
    isAuthenticated,
    hasPermission('umrah'),
    upload.single('image'),
    wrap(async (req, res) => {
      const body = { ...req.body };
      if (typeof body.includes === 'string') {
        try {
          body.includes = JSON.parse(body.includes);
        } catch {
          body.includes = [];
        }
      }
      if (typeof body.isActive === 'string') body.isActive = body.isActive === 'true';
      const old = await UmrahPackage.findById(req.params.id);
      if (!old) return res.status(404).json({ error: 'প্যাকেজ পাওয়া যায়নি' });
      if (req.file) {
        if (old.image) await deleteImage(old.image);
        body.image = await uploadImage(req.file.buffer, req.file.mimetype);
      }
      const pkg = await UmrahPackage.findByIdAndUpdate(req.params.id, body, { new: true });
      res.json({ success: true, package: pkg, message: 'প্যাকেজ আপডেট হয়েছে' });
    })
  );

  app.delete(
    '/api/umrah/:id',
    isAuthenticated,
    hasPermission('umrah'),
    wrap(async (req, res) => {
      const p = await UmrahPackage.findById(req.params.id);
      if (!p) return res.status(404).json({ error: 'প্যাকেজ পাওয়া যায়নি' });
      if (p.image) await deleteImage(p.image);
      await p.deleteOne();
      res.json({ success: true, message: 'প্যাকেজ মুছে দেওয়া হয়েছে' });
    })
  );

  // ---------- Blog ----------
  app.get(
    '/api/blog',
    wrap(async (req, res) => {
      const showAll = req.query.all === 'true';
      const filter = showAll ? {} : { isPublished: true };
      const posts = await BlogPost.find(filter).sort({ createdAt: -1 });
      res.json(posts);
    })
  );

  app.get(
    '/api/blog/:id',
    wrap(async (req, res) => {
      const post = await BlogPost.findById(req.params.id);
      if (!post) return res.status(404).json({ error: 'পোস্ট পাওয়া যায়নি' });
      res.json(post);
    })
  );

  app.post(
    '/api/blog',
    isAuthenticated,
    hasPermission('blog'),
    upload.single('image'),
    wrap(async (req, res) => {
      const body = { ...req.body };
      if (typeof body.isPublished === 'string') body.isPublished = body.isPublished === 'true';
      if (req.file) body.image = await uploadImage(req.file.buffer, req.file.mimetype);
      if (!body.author) body.author = req.user.name;
      const post = await BlogPost.create(body);
      res.json({ success: true, post, message: 'পোস্ট প্রকাশিত হয়েছে' });
    })
  );

  app.put(
    '/api/blog/:id',
    isAuthenticated,
    hasPermission('blog'),
    upload.single('image'),
    wrap(async (req, res) => {
      const body = { ...req.body };
      if (typeof body.isPublished === 'string') body.isPublished = body.isPublished === 'true';
      const old = await BlogPost.findById(req.params.id);
      if (!old) return res.status(404).json({ error: 'পোস্ট পাওয়া যায়নি' });
      if (req.file) {
        if (old.image) await deleteImage(old.image);
        body.image = await uploadImage(req.file.buffer, req.file.mimetype);
      }
      const post = await BlogPost.findByIdAndUpdate(req.params.id, body, { new: true });
      res.json({ success: true, post, message: 'পোস্ট আপডেট হয়েছে' });
    })
  );

  app.delete(
    '/api/blog/:id',
    isAuthenticated,
    hasPermission('blog'),
    wrap(async (req, res) => {
      const p = await BlogPost.findById(req.params.id);
      if (!p) return res.status(404).json({ error: 'পোস্ট পাওয়া যায়নি' });
      if (p.image) await deleteImage(p.image);
      await p.deleteOne();
      res.json({ success: true, message: 'পোস্ট মুছে দেওয়া হয়েছে' });
    })
  );

  // ---------- Services ----------
  app.get(
    '/api/services',
    wrap(async (req, res) => {
      const list = await Service.find().sort({ createdAt: -1 });
      res.json(list);
    })
  );

  app.post(
    '/api/services',
    isAuthenticated,
    hasPermission('services'),
    upload.single('image'),
    wrap(async (req, res) => {
      const body = { ...req.body };
      if (typeof body.isActive === 'string') body.isActive = body.isActive === 'true';
      if (req.file) body.image = await uploadImage(req.file.buffer, req.file.mimetype);
      const svc = await Service.create(body);
      res.json({ success: true, service: svc, message: 'সার্ভিস যোগ হয়েছে' });
    })
  );

  app.put(
    '/api/services/:id',
    isAuthenticated,
    hasPermission('services'),
    upload.single('image'),
    wrap(async (req, res) => {
      const body = { ...req.body };
      if (typeof body.isActive === 'string') body.isActive = body.isActive === 'true';
      const old = await Service.findById(req.params.id);
      if (!old) return res.status(404).json({ error: 'সার্ভিস পাওয়া যায়নি' });
      if (req.file) {
        if (old.image) await deleteImage(old.image);
        body.image = await uploadImage(req.file.buffer, req.file.mimetype);
      }
      const svc = await Service.findByIdAndUpdate(req.params.id, body, { new: true });
      res.json({ success: true, service: svc, message: 'সার্ভিস আপডেট হয়েছে' });
    })
  );

  app.delete(
    '/api/services/:id',
    isAuthenticated,
    hasPermission('services'),
    wrap(async (req, res) => {
      const s = await Service.findById(req.params.id);
      if (!s) return res.status(404).json({ error: 'সার্ভিস পাওয়া যায়নি' });
      if (s.image) await deleteImage(s.image);
      await s.deleteOne();
      res.json({ success: true, message: 'সার্ভিস মুছে দেওয়া হয়েছে' });
    })
  );

  // ---------- Gallery ----------
  app.get(
    '/api/gallery',
    wrap(async (req, res) => {
      const list = await Gallery.find().sort({ createdAt: -1 });
      res.json(list);
    })
  );

  app.post(
    '/api/gallery',
    isAuthenticated,
    hasPermission('gallery'),
    upload.single('image'),
    wrap(async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'ছবি প্রয়োজন' });
      const url = await uploadImage(req.file.buffer, req.file.mimetype);
      const item = await Gallery.create({
        title: req.body.title || '',
        description: req.body.description || '',
        category: req.body.category || 'সাধারণ',
        image: url,
      });
      res.json({ success: true, gallery: item });
    })
  );

  app.delete(
    '/api/gallery/:id',
    isAuthenticated,
    hasPermission('gallery'),
    wrap(async (req, res) => {
      const g = await Gallery.findById(req.params.id);
      if (!g) return res.status(404).json({ error: 'ছবি পাওয়া যায়নি' });
      if (g.image) await deleteImage(g.image);
      await g.deleteOne();
      res.json({ success: true, message: 'ছবি মুছে দেওয়া হয়েছে' });
    })
  );

  // ---------- Applications ----------
  app.post(
    '/api/applications',
    wrap(async (req, res) => {
      const { name, email, phone, service, message } = req.body;
      if (!name || !email)
        return res.status(400).json({ error: 'নাম ও ইমেইল প্রয়োজন' });
      const app = await Application.create({ name, email, phone, service, message });
      res.json({ success: true, application: app, message: 'আবেদন গ্রহণ করা হয়েছে' });
    })
  );

  app.get(
    '/api/applications',
    isAuthenticated,
    hasPermission('applications'),
    wrap(async (req, res) => {
      const apps = await Application.find().sort({ createdAt: -1 });
      res.json(apps);
    })
  );

  app.put(
    '/api/applications/:id/status',
    isAuthenticated,
    hasPermission('applications'),
    wrap(async (req, res) => {
      const { status, notes } = req.body;
      const updates = {};
      if (status) updates.status = status;
      if (notes !== undefined) updates.notes = notes;
      const app = await Application.findByIdAndUpdate(req.params.id, updates, { new: true });
      if (!app) return res.status(404).json({ error: 'পাওয়া যায়নি' });
      res.json({ success: true, application: app });
    })
  );

  app.delete(
    '/api/applications/:id',
    isAuthenticated,
    hasPermission('applications'),
    wrap(async (req, res) => {
      const app = await Application.findByIdAndDelete(req.params.id);
      if (!app) return res.status(404).json({ error: 'পাওয়া যায়নি' });
      res.json({ success: true, message: 'মুছে ফেলা হয়েছে' });
    })
  );

  // ---------- Dashboard / analytics ----------
  app.get(
    '/api/dashboard/stats',
    isAuthenticated,
    wrap(async (req, res) => {
      const [
        totalApplications,
        pendingApplications,
        completedApplications,
        totalTeamMembers,
        totalUmrahPackages,
        totalBlogPosts,
        totalServices,
        totalGallery,
      ] = await Promise.all([
        Application.countDocuments(),
        Application.countDocuments({ status: 'pending' }),
        Application.countDocuments({ status: 'approved' }),
        TeamMember.countDocuments(),
        UmrahPackage.countDocuments(),
        BlogPost.countDocuments(),
        Service.countDocuments(),
        Gallery.countDocuments(),
      ]);
      res.json({
        totalApplications,
        pendingApplications,
        completedApplications,
        totalTeamMembers,
        totalUmrahPackages,
        totalBlogPosts,
        totalServices,
        totalGallery,
      });
    })
  );

  app.get(
    '/api/analytics',
    isAuthenticated,
    hasPermission('analytics'),
    wrap(async (req, res) => {
      const [total, pending, inProgress, approved, rejected] = await Promise.all([
        Application.countDocuments(),
        Application.countDocuments({ status: 'pending' }),
        Application.countDocuments({ status: 'in_progress' }),
        Application.countDocuments({ status: 'approved' }),
        Application.countDocuments({ status: 'rejected' }),
      ]);
      res.json({
        applicationStats: { total, pending, inProgress, approved, rejected },
        totalVisitors: 0,
        totalPageViews: 0,
        activeSessions: 0,
        avgSessionDuration: '—',
      });
    })
  );

  // ---------- Error handler ----------
  app.use((err, req, res, next) => {
    console.error('API error:', err);
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `ফাইল আপলোড ত্রুটি: ${err.message}` });
    }
    res.status(err.status || 500).json({ error: err.message || 'সার্ভার ত্রুটি' });
  });

  return app;
}
