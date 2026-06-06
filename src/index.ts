import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/hello-world', (req, res) => {
  res.json({ response: 'Hello World' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
