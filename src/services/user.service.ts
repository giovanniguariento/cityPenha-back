import { User } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";

export class UserService {
  public async create(user: User) {
    return await prisma.user.create({
      data: user
    });
  }

  public async findByFirebaseUid(firebaseUid: string) {
    return await prisma.user.findUnique(
      {
        where: {
          firebaseUid
        }
      }
    )
  }
}