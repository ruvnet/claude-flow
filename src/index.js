import express from 'express';
import cors from 'cors';
import process from 'node:process';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Welcome to project2 API' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
