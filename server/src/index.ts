import { createApp } from './app.js';
import { seedIfEmpty } from './seed.js';

const port = Number(process.env.PORT || 4000);
seedIfEmpty();
const app = createApp();
app.listen(port, () => {
  console.log(`HRMS server listening on http://localhost:${port}`);
});
