import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Category, Prisma, Status } from '@prisma/client';
import { PrismaService } from '../../platform/prisma/prisma.service';
import type {
  CreateTaxonomyTermDto,
  UpdateStatusDto,
  UpdateTaxonomyTermDto,
} from './dto/taxonomy.dto';

/** Postgres foreign-key violation, surfaced by Prisma when a term is still referenced. */
const FOREIGN_KEY_VIOLATION = 'P2003';
const UNIQUE_VIOLATION = 'P2002';

/**
 * Slugs are derived rather than supplied. They are the stable identifier used in filter
 * URLs and in the settings blob, so letting them be edited freely would break saved links
 * and stored default filters. The display name stays editable; the slug does not.
 */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    // NFKD splits an accented character into a base letter plus a combining mark. The
    // mark is neither a letter nor a number, so without this it becomes a separator and
    // "Ünicode Wörter" slugs to "u-nicode-wo-rter". Strip the marks, keep the letters.
    .replace(/\p{Mark}+/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  listCategories(includeRetired = false): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: includeRetired ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  listStatuses(includeRetired = false): Promise<Status[]> {
    return this.prisma.status.findMany({
      where: includeRetired ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(dto: CreateTaxonomyTermDto): Promise<Category> {
    return this.guardUnique(dto.name, () =>
      this.prisma.category.create({
        data: { slug: this.requireSlug(dto.name), name: dto.name, ...this.optional(dto) },
      }),
    );
  }

  async updateCategory(id: string, dto: UpdateTaxonomyTermDto): Promise<Category> {
    await this.requireCategory(id);

    return this.prisma.category.update({
      where: { id },
      data: { name: dto.name, color: dto.color, sortOrder: dto.sortOrder, isActive: dto.isActive },
    });
  }

  async deleteCategory(id: string): Promise<void> {
    await this.requireCategory(id);
    await this.deleteOrExplain(
      () => this.prisma.category.delete({ where: { id } }),
      'category',
    );
  }

  async createStatus(dto: CreateTaxonomyTermDto): Promise<Status> {
    return this.guardUnique(dto.name, () =>
      this.prisma.status.create({
        data: { slug: this.requireSlug(dto.name), name: dto.name, ...this.optional(dto) },
      }),
    );
  }

  /**
   * Promoting a status to default clears the previous one first, in the same transaction.
   *
   * The order is not stylistic. `statuses_single_default_idx` is a partial unique index, so
   * a transaction that sets the new default before clearing the old one is rejected
   * outright — verified against the database. Clearing first is the only sequence that
   * works, and doing both in one transaction is what stops a failure halfway leaving the
   * board with no default at all.
   */
  async updateStatus(id: string, dto: UpdateStatusDto): Promise<Status> {
    const existing = await this.requireStatus(id);

    if (dto.isActive === false && existing.isDefault) {
      throw new BadRequestException(
        'The default status cannot be retired. Make another status the default first.',
      );
    }
    if (dto.isDefault === false && existing.isDefault) {
      throw new BadRequestException(
        'A status cannot stop being the default on its own. Make another status the default instead.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true && !existing.isDefault) {
        await tx.status.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }

      return tx.status.update({
        where: { id },
        data: {
          name: dto.name,
          color: dto.color,
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
          // Retiring the default is refused above, so a status being made default is also
          // being kept active.
          isDefault: dto.isDefault === true ? true : undefined,
        },
      });
    });
  }

  async deleteStatus(id: string): Promise<void> {
    const existing = await this.requireStatus(id);

    if (existing.isDefault) {
      throw new BadRequestException(
        'The default status cannot be deleted. Make another status the default first.',
      );
    }

    await this.deleteOrExplain(() => this.prisma.status.delete({ where: { id } }), 'status');
  }

  private optional(dto: CreateTaxonomyTermDto): { color?: string; sortOrder?: number } {
    return { color: dto.color, sortOrder: dto.sortOrder };
  }

  private requireSlug(name: string): string {
    const slug = toSlug(name);

    if (!slug) {
      throw new BadRequestException({
        message: 'That name cannot be used.',
        errors: { name: ['The name must contain at least one letter or number.'] },
      });
    }

    return slug;
  }

  private async guardUnique<T>(name: string, create: () => Promise<T>): Promise<T> {
    try {
      return await create();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(`A term with the name “${name}” already exists.`);
      }
      throw error;
    }
  }

  /**
   * Deleting a term that is still in use is refused by a foreign key rather than silently
   * orphaning or cascading. The 409 points the administrator at retiring instead, which is
   * what the brief's "retires an unused one" describes.
   */
  private async deleteOrExplain(remove: () => Promise<unknown>, kind: string): Promise<void> {
    try {
      await remove();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new ConflictException(
          `That ${kind} is still used by existing requests. Retire it instead of deleting it.`,
        );
      }
      throw error;
    }
  }

  private async requireCategory(id: string): Promise<Category> {
    const found = await this.prisma.category.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('That category does not exist.');
    return found;
  }

  private async requireStatus(id: string): Promise<Status> {
    const found = await this.prisma.status.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('That status does not exist.');
    return found;
  }
}
