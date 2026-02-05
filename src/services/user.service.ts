import type { UserUncheckedCreateInput } from '../generated/prisma/models/User';
import type { User } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';

export class UserService {
  async create(data: UserUncheckedCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { firebaseUid } });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }
}