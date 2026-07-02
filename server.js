import dotenv from 'dotenv';
dotenv.config();

import { createApp, connectDB } from './app.js';

const PORT = process.env.PORT || 5000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Backend running: http://localhost:${PORT}`);
  console.log(
    `Default admin: ${process.env.ADMIN_EMAIL || 'yousufconsultancy46@gmail.com'} / ${
      process.env.ADMIN_PASSWORD || '0571446@#'
    }`
  );
});

connectDB().catch((e) => console.error('Initial DB connect failed:', e.message));
