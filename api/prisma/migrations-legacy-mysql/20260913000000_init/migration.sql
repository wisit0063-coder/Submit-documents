-- CreateTable
CREATE TABLE `faculties` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `name_th` VARCHAR(255) NOT NULL,
    `name_en` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `faculties_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `faculty_id` BIGINT NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name_th` VARCHAR(255) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `departments_faculty_id_idx`(`faculty_id`),
    UNIQUE INDEX `departments_faculty_id_code_key`(`faculty_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `prefix` VARCHAR(50) NULL,
    `first_name` VARCHAR(150) NOT NULL,
    `last_name` VARCHAR(150) NOT NULL,
    `academic_position` VARCHAR(150) NULL,
    `department_id` BIGINT NULL,
    `phone_internal` VARCHAR(20) NULL,
    `phone_mobile` VARCHAR(20) NULL,
    `line_user_id` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_department_id_idx`(`department_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name_th` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `role_id` BIGINT NOT NULL,
    `faculty_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_role_id_idx`(`role_id`),
    UNIQUE INDEX `user_roles_user_id_role_id_faculty_id_key`(`user_id`, `role_id`, `faculty_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_tiers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name_th` VARCHAR(255) NOT NULL,
    `database_name` VARCHAR(100) NOT NULL,
    `quartile` VARCHAR(5) NULL,
    `rate_normal` DECIMAL(12, 2) NOT NULL,
    `rate_conference` DECIMAL(12, 2) NOT NULL,
    `announcement_ref` VARCHAR(100) NULL,
    `effective_from` DATE NOT NULL,
    `effective_to` DATE NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `journal_tiers_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_years` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `year` INTEGER NOT NULL,
    `total_amount` DECIMAL(14, 2) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `budget_years_year_key`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requests` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `request_no` VARCHAR(30) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `faculty_id` BIGINT NOT NULL,
    `department_id` BIGINT NOT NULL,
    `article_title` TEXT NOT NULL,
    `journal_name` VARCHAR(500) NOT NULL,
    `volume` VARCHAR(50) NULL,
    `issue` VARCHAR(50) NULL,
    `pages` VARCHAR(50) NULL,
    `issn` VARCHAR(20) NULL,
    `doi` VARCHAR(255) NULL,
    `article_url` TEXT NULL,
    `published_at` DATE NOT NULL,
    `journal_tier_id` BIGINT NOT NULL,
    `from_conference` BOOLEAN NOT NULL DEFAULT false,
    `amount_requested` DECIMAL(12, 2) NOT NULL,
    `amount_approved` DECIMAL(12, 2) NULL,
    `calendar_year` INTEGER NOT NULL,
    `sequence_in_year` INTEGER NULL,
    `budget_year_id` BIGINT NOT NULL,
    `qa_indicator_year` INTEGER NULL,
    `cert_not_on_study_leave` BOOLEAN NOT NULL DEFAULT false,
    `cert_not_thesis_part` BOOLEAN NOT NULL DEFAULT false,
    `cert_not_duplicate` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('DRAFT', 'FACULTY_REVIEW', 'DEAN_REVIEW', 'RDI_REVIEW', 'RETURNED', 'ACADEMIC_OFFICE_REVIEW', 'COMMITTEE_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED', 'REFUNDED') NOT NULL DEFAULT 'DRAFT',
    `current_step` INTEGER NOT NULL DEFAULT 0,
    `submitted_at` DATETIME(3) NULL,
    `approved_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `requests_request_no_key`(`request_no`),
    INDEX `requests_user_id_calendar_year_idx`(`user_id`, `calendar_year`),
    INDEX `requests_status_idx`(`status`),
    INDEX `requests_doi_idx`(`doi`),
    INDEX `requests_budget_year_id_idx`(`budget_year_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_attachments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `request_id` BIGINT NOT NULL,
    `doc_type` ENUM('ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF', 'ADDITIONAL') NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `stored_path` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `uploaded_by` BIGINT NOT NULL,
    `is_verified` BOOLEAN NOT NULL DEFAULT false,
    `verified_by` BIGINT NULL,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_attachments_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_approvals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `request_id` BIGINT NOT NULL,
    `step_order` INTEGER NOT NULL,
    `step_code` ENUM('FACULTY_QA', 'DEAN', 'RDI', 'ACADEMIC_OFFICE', 'COMMITTEE', 'APPROVER') NOT NULL,
    `approver_id` BIGINT NULL,
    `decision` ENUM('PENDING', 'APPROVED', 'RETURNED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `comment` TEXT NULL,
    `missing_documents` TEXT NULL,
    `amount_approved` DECIMAL(12, 2) NULL,
    `signed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_approvals_approver_id_decision_idx`(`approver_id`, `decision`),
    UNIQUE INDEX `request_approvals_request_id_step_order_key`(`request_id`, `step_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `request_status_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `request_id` BIGINT NOT NULL,
    `from_status` ENUM('DRAFT', 'FACULTY_REVIEW', 'DEAN_REVIEW', 'RDI_REVIEW', 'RETURNED', 'ACADEMIC_OFFICE_REVIEW', 'COMMITTEE_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED', 'REFUNDED') NULL,
    `to_status` ENUM('DRAFT', 'FACULTY_REVIEW', 'DEAN_REVIEW', 'RDI_REVIEW', 'RETURNED', 'ACADEMIC_OFFICE_REVIEW', 'COMMITTEE_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED', 'REFUNDED') NOT NULL,
    `actor_id` BIGINT NULL,
    `note` TEXT NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `request_status_logs_request_id_created_at_idx`(`request_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `request_id` BIGINT NOT NULL,
    `budget_year_id` BIGINT NOT NULL,
    `voucher_no` VARCHAR(50) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paid_at` DATETIME(3) NULL,
    `recorded_by` BIGINT NOT NULL,
    `is_refunded` BOOLEAN NOT NULL DEFAULT false,
    `refund_amount` DECIMAL(12, 2) NULL,
    `refund_reason` TEXT NULL,
    `refunded_at` DATETIME(3) NULL,
    `note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_request_id_key`(`request_id`),
    INDEX `payments_budget_year_id_idx`(`budget_year_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `departments` ADD CONSTRAINT `departments_faculty_id_fkey` FOREIGN KEY (`faculty_id`) REFERENCES `faculties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_faculty_id_fkey` FOREIGN KEY (`faculty_id`) REFERENCES `faculties`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_journal_tier_id_fkey` FOREIGN KEY (`journal_tier_id`) REFERENCES `journal_tiers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_budget_year_id_fkey` FOREIGN KEY (`budget_year_id`) REFERENCES `budget_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_attachments` ADD CONSTRAINT `request_attachments_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_attachments` ADD CONSTRAINT `request_attachments_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_attachments` ADD CONSTRAINT `request_attachments_verified_by_fkey` FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_approvals` ADD CONSTRAINT `request_approvals_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_approvals` ADD CONSTRAINT `request_approvals_approver_id_fkey` FOREIGN KEY (`approver_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_status_logs` ADD CONSTRAINT `request_status_logs_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `request_status_logs` ADD CONSTRAINT `request_status_logs_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_budget_year_id_fkey` FOREIGN KEY (`budget_year_id`) REFERENCES `budget_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_recorded_by_fkey` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

