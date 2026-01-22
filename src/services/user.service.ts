import { User } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";

export class UserService {
  public async createUser(user: User) {
    return await prisma.user.create({
      data: user
    });
  }
}