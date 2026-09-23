-- AlterTable
ALTER TABLE `users` ADD COLUMN `faculty_id` BIGINT NULL,
    ADD COLUMN `registration_note` TEXT NULL,
    ADD COLUMN `registration_reviewed_at` DATETIME(3) NULL,
    ADD COLUMN `registration_reviewed_by` BIGINT NULL,
    ADD COLUMN `registration_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NULL,
    ADD COLUMN `staff_track` ENUM('ACADEMIC', 'SUPPORT') NULL;

-- CreateIndex
CREATE INDEX `users_faculty_id_idx` ON `users`(`faculty_id`);

-- CreateIndex
CREATE INDEX `users_registration_status_idx` ON `users`(`registration_status`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_faculty_id_fkey` FOREIGN KEY (`faculty_id`) REFERENCES `faculties`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_registration_reviewed_by_fkey` FOREIGN KEY (`registration_reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: accounts created before this migration took their faculty from their
-- department. Copy it onto the user so the unit is known without a department.
UPDATE `users` u
  JOIN `departments` d ON d.`id` = u.`department_id`
   SET u.`faculty_id` = d.`faculty_id`
 WHERE u.`faculty_id` IS NULL;
