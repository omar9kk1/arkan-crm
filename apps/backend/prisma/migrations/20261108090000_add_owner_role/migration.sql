-- Add the OWNER role without reordering the existing enum values.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER';
