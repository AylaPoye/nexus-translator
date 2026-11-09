# NEXUS Translator (iOS & Web - React Native Expo)

แอปพลิเคชันแปลนิยายจีนกำลังภายใน/เทพเซียน และระบบพากย์เสียงละครวิทยุ AI ถอดแบบสถาปัตยกรรมและตรรกะการแปลจาก **NEXUS Translator** (`com.thanawat.nexustranslator`)

---

## 🌟 ฟีเจอร์หลัก (Features)

1. **สถาปัตยกรรมระดับ Core 81.8KB (`nexus_translator_core.ts`)**:
   - โปรโตคอลการแปลแบบระบุบรรทัด `<LINE_NNNN>` ตรวจสอบความถูกต้องและป้องกันบรรทัดตกหล่น
   - การตรวจจับเลขจีนโบราณพร้อมข้ามสำนวน (Numeric Idiom Bypass เช่น 乱七八糟, 千方百计)
   - วงรอบการซ่อมแซมคำแปลอัตโนมัติ (Surgical Repair Loop) เมื่อตรวจพบ Foreign Residue หรือ Glossary Mismatch
   - การกรองข้อความที่ไม่ใช่เนื้อเรื่อง (Non-Story Detection: ชื่อตอน, ลายน้ำเว็บ, คำลงท้าย)

2. **ระบบ Failover หลายคีย์ (Multi-Key Failover)**:
   - สลับ Gemini API Keys อัตโนมัติ (ช่องที่ 1 -> 2 -> 3) เมื่อโควต้าเต็ม (Rate-limit 429)
   - สลับไปใช้งาน Groq Cloud API (โมเดล `qwen/qwen3.8-27b` ความเร็ว 300+ tokens/s) เป็นทางเลือกสำรอง

3. **สมองกลเน็กซัส (NEXUS Brain & Relationships)**:
   - คลังคำศัพท์และชื่อตัวละคร จัดหมวดหมู่: ตัวละคร (Character), สถานที่ (Place), วิชายุทธ์ (Technique), ระดับพลัง (Cultivation)
   - ระบบจับคู่สรรพนามและลำดับอาวุโส (Pronoun Matrix: ศิษย์พี่, ศิษย์น้อง, ข้า, เจ้า, อาจารย์)

4. **เครื่องเล่นละครวิทยุ AI (Procedural Radio Drama Synthesizer)**:
   - สังเคราะห์เสียงบรรยากาศตามสถานการณ์แบบ Procedural Web Audio API โดยไม่ต้องดาวน์โหลดไฟล์เสียงภายนอก
   - ตรวจจับ 11 สถานการณ์ภาษาไทยอัตโนมัติ: สายฝน (RAIN), พายุคลั่ง (STORM), ป่าทึบ (FOREST), ถ้ำลึกลับ (CAVE), ศึกประจัญ (BATTLE), เพลิงผลาญ (FIRE), ราตรีกาล (NIGHT), ตลาดพลุกพล่าน (CROWD), ทะลวงด่าน (BREAKTHROUGH), ตึงเครียด (TENSION), โศกศัลย์ (SADNESS)
   - ระบบลดเสียงบรรยากาศอัตโนมัติ (Audio Ducking) ขณะเสียงพากย์ TTS กำลังพูด

5. **โหมดการอ่านและการแก้ไขเฉพาะจุด (Reader & Surgical Repair)**:
   - ปรับขนาดตัวอักษร, ระยะห่างบรรทัด, ธีมหน้าจอ (Dark, OLED Black, Sepia, Light)
   - โหมดแสดงผล: ภาษาไทยล้วน, ภาษาจีนคู่ภาษาไทย (Bilingual), ภาษาจีนล้วน
   - แตะที่บรรทัดเพื่อดูต้นฉบับภาษาจีน และแก้ไขคำแปลเฉพาะจุดได้ทันที (Surgical Repair Modal)

---

## 🚀 วิธีเปิดใช้งาน (How to Run)

โครงการติดตั้งอยู่ที่: `C:\Users\BBrea\Projects\nexus-translator-app` (และซิงค์สำเนาโค้ดไว้ที่ `M:\My Drive\Omniroute\nexus-translator-app`)

### 1. เปิดใช้งานบนเบราว์เซอร์ PC (Web Mode)
เปิด PowerShell หรือ Terminal แล้วพิมพ์:
```powershell
cd C:\Users\BBrea\Projects\nexus-translator-app
pnpm run web
```
หรือ
```powershell
npx expo start --web
```
ระบบจะเปิดหน้าเว็บที่ `http://localhost:8081` พร้อมระบบเสียง Web Audio Synthesizer แบบเต็มรูปแบบ

---

### 2. เปิดใช้งานบน iPhone (iOS Mode ผ่าน Expo Go)
1. ดาวน์โหลดแอป **Expo Go** จาก App Store บน iPhone
2. ในคอมพิวเตอร์ของคุณ ให้รันคำสั่ง:
   ```powershell
   cd C:\Users\BBrea\Projects\nexus-translator-app
   npx expo start
   ```
3. เปิดแอป **Camera (กล้องถ่ายรูป)** บน iPhone แล้วสแกน QR Code ที่แสดงขึ้นมาบน Terminal
4. แตะเพื่อเปิดแอปใน Expo Go จะสามารถใช้งานบน iPhone ได้ทันที

---

## 🔑 การตั้งค่า API Key

1. เข้าไปที่เมนู **การตั้งค่า (Settings)** ที่มุมขวาบนของหน้าจอแอป
2. นำ **Google Gemini API Key** (ขอฟรีได้จาก [Google AI Studio](https://aistudio.google.com/)) มาใส่ในช่อง Gemini Key 1, 2, 3
3. (ไม่บังคับ) หากมี Groq API Key สามารถใส่ในช่อง Groq Cloud API เพื่อใช้เป็นคีย์สำรอง
4. กดปุ่ม **"ทดสอบ"** เพื่อยืนยันว่าคีย์สามารถใช้งานได้ปกติ จากนั้นกด **"บันทึก API Keys ทั้งหมด"**
