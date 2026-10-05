-- ปีที่หักสิทธิ์ 3 เรื่องต่อปี แยกออกจากปีที่บทความตีพิมพ์
--
-- ประกาศนับสิทธิ์ตามปีปฏิทิน แต่บทความที่ตีพิมพ์เดือนธันวาคมยื่นได้ถึง 31 ม.ค.
-- ของปีถัดไป และการยื่นในช่วงผ่อนผันนั้นกินสิทธิ์ของ "ปีที่ยื่น" ไม่ใช่ปีที่ตีพิมพ์
-- จึงต้องเก็บแยกจาก calendar_year ที่ยังหมายถึงปีตีพิมพ์ตามเดิม (ใช้ในรายงาน)
--
-- NULL ได้ เพราะฉบับร่างยังไม่ได้ยื่นจึงยังไม่กินสิทธิ์ของปีใด
ALTER TABLE "requests" ADD COLUMN "entitlement_year" INTEGER;

-- คำขอเดิมที่ยื่นไปแล้ว: ก่อนมีกฎผ่อนผัน ปีที่ยื่นเท่ากับปีที่ตีพิมพ์เสมอ
-- (กฎข้อ 8 บังคับไว้) จึงเติมจาก calendar_year ได้ตรงตามความจริง
UPDATE "requests" SET "entitlement_year" = "calendar_year" WHERE "submitted_at" IS NOT NULL;

CREATE INDEX "requests_user_id_entitlement_year_idx" ON "requests"("user_id", "entitlement_year");
