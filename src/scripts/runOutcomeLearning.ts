import 'dotenv/config';
import { runOutcomeLearning } from '../agents/outcomeLearningAgent.js';

async function main() {
  await runOutcomeLearning();
  process.exit(0);
}

main().catch((error) => {
  console.error('Outcome learning runner failed:', error);
  process.exit(1);
});