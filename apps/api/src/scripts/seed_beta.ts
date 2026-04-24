import "dotenv/config";
import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  await prisma.betaCode.upsert({
    where: { code: "4ZEQ-8FSC-L2SN" },
    update: { type: "registration", usedById: null, usedAt: null },
    create: { code: "4ZEQ-8FSC-L2SN", type: "registration" },
  });

  await prisma.betaCode.upsert({
    where: { code: "5F21-6GSL-O4XA" },
    update: { type: "group_creation", usedById: null, usedAt: null },
    create: { code: "5F21-6GSL-O4XA", type: "group_creation" },
  });

  console.log("Beta codes inserted");
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
