-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "birth_date" DATE,
ADD COLUMN     "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketing_opt_in_at" TIMESTAMP(3);
