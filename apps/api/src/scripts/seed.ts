import "dotenv/config";
import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { promisify } from "util";
import { scrypt, randomBytes } from "crypto";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://friendgroup:friendgroup@localhost:5432/friendgroup_dev";

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Dev test user — bypasses password rules, emailVerified=true
  const devPasswordHash = await hashPassword("password");
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {
      name: "Seed Admin",
      username: "seedadmin",
      passwordHash: devPasswordHash,
      emailVerified: true,
    },
    create: {
      email: "admin@example.com",
      name: "Seed Admin",
      username: "seedadmin",
      passwordHash: devPasswordHash,
      emailVerified: true,
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: "owner@friendgroup.dev" },
    update: { name: "Owner User" },
    create: { email: "owner@friendgroup.dev", name: "Owner User" },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@friendgroup.dev" },
    update: { name: "Admin User" },
    create: { email: "admin@friendgroup.dev", name: "Admin User" },
  });

  const member = await prisma.user.upsert({
    where: { email: "member@friendgroup.dev" },
    update: { name: "Member User" },
    create: { email: "member@friendgroup.dev", name: "Member User" },
  });

  let group = await prisma.group.findFirst({
    where: { name: "Demo Friendgroup" },
  });

  if (!group) {
    group = await prisma.group.create({
      data: {
        name: "Demo Friendgroup",
        ownerId: owner.id,
      },
    });
  } else if (group.ownerId !== owner.id) {
    group = await prisma.group.update({
      where: { id: group.id },
      data: { ownerId: owner.id },
    });
  }

  await prisma.membership.upsert({
    where: {
      userId_groupId: {
        userId: owner.id,
        groupId: group.id,
      },
    },
    update: { role: "owner" },
    create: {
      userId: owner.id,
      groupId: group.id,
      role: "owner",
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_groupId: {
        userId: admin.id,
        groupId: group.id,
      },
    },
    update: { role: "admin" },
    create: {
      userId: admin.id,
      groupId: group.id,
      role: "admin",
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_groupId: {
        userId: member.id,
        groupId: group.id,
      },
    },
    update: { role: "member" },
    create: {
      userId: member.id,
      groupId: group.id,
      role: "member",
    },
  });

  const tagNames = ["sports", "gaming", "travel", "food"];
  const tags = [];

  for (const tagName of tagNames) {
    const tag = await prisma.tag.upsert({
      where: {
        groupId_name: {
          groupId: group.id,
          name: tagName,
        },
      },
      update: {},
      create: {
        groupId: group.id,
        name: tagName,
      },
    });
    tags.push(tag);
  }

  console.log("Seed complete");
  console.log(
    JSON.stringify(
      {
        group: { id: group.id, name: group.name },
        users: {
          owner: { id: owner.id, email: owner.email },
          admin: { id: admin.id, email: admin.email },
          member: { id: member.id, email: member.email },
        },
        tags: tags.map((t) => ({ id: t.id, name: t.name })),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
