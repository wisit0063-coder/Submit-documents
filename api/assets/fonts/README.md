# ฟอนต์ Sarabun สำหรับออก PDF

pdfmake ต้องอ่านไฟล์ฟอนต์จากดิสก์ ระบบจึงต้องมีไฟล์ 4 ไฟล์นี้อยู่ในโฟลเดอร์นี้
มิฉะนั้น endpoint `GET /api/requests/:id/document` จะคืน error `FONT_NOT_INSTALLED`
(เลือกให้ fail ชัดเจน ดีกว่าออก PDF ที่ข้อความไทยหายทั้งหน้า)

```
Sarabun-Regular.ttf
Sarabun-Bold.ttf
Sarabun-Italic.ttf
Sarabun-BoldItalic.ttf
```

## วิธีติดตั้ง

**Docker** ไม่ต้องทำอะไร ตอน build image ระบบดาวน์โหลดให้อัตโนมัติ
ถ้าเครื่อง build ออกอินเทอร์เน็ตไม่ได้ ให้วางไฟล์ไว้ที่นี่แล้วตั้ง `FETCH_FONTS=false` ใน `.env`

**ไม่ใช้ Docker** รันคำสั่งนี้ในโฟลเดอร์ `api/`

```bash
npm run fonts
```

สคริปต์ดาวน์โหลดจาก repository google/fonts และข้ามไฟล์ที่มีอยู่แล้ว ไฟล์ที่วางเองจึงไม่ถูกเขียนทับ

ฟอนต์ Sarabun ใช้สัญญาอนุญาต SIL Open Font License 1.1 แจกจ่ายต่อได้
ไม่ได้ commit ลง git เพื่อไม่ให้ repository ใหญ่เกินจำเป็น
