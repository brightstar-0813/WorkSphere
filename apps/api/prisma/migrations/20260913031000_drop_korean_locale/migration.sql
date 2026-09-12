-- Drop Korean locale from existing users
UPDATE "User" SET locale = 'en' WHERE locale = 'ko';
