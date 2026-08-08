import { prisma } from "../src/db.js";

const username = process.argv[2];
if (!username) {
  console.error("Usage: npm run promote-admin -- <username>");
  process.exit(1);
}

const account = await prisma.account.findUnique({ where: { username } });
if (!account) {
  console.error(`No account found with username "${username}".`);
  process.exit(1);
}

await prisma.account.update({ where: { username }, data: { role: "admin" } });
console.log(`"${username}" is now an admin.`);
