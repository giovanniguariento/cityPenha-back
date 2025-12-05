import app from './app';

const PORT = process.env.PORT || 3000;

app.listen(3000, "0.0.0.0", () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
