# 📚 HƯỚNG DẪN CÀI ĐẶT THƯ VIỆN ARDUINO

## 🔧 CÁC THƯ VIỆN CẦN THIẾT

Code Smart Locker cần các thư viện sau:

1. ✅ **ESP32Servo** - Điều khiển Servo motor
2. ✅ **Firebase ESP Client** - Kết nối Firebase Realtime Database
3. ✅ **WiFi** - Đã có sẵn trong ESP32 (không cần cài)

---

## 📦 CÁCH 1: CÀI QUA LIBRARY MANAGER (KHUYẾN NGHỊ)

### Bước 1: Mở Library Manager
1. Mở **Arduino IDE**
2. Vào menu: **Sketch** → **Include Library** → **Manage Libraries...**
3. Hoặc nhấn **Ctrl + Shift + I**

### Bước 2: Cài ESP32Servo
1. Trong ô tìm kiếm, gõ: **ESP32Servo**
2. Tìm thư viện: **ESP32Servo** (tác giả: Kevin Harrington)
3. Nhấn nút **Install**
4. Đợi cài đặt xong

### Bước 3: Cài Firebase ESP Client
1. Trong ô tìm kiếm, gõ: **Firebase ESP Client**
2. Tìm thư viện: **Firebase ESP32 Client** (tác giả: Mobizt)
3. Nhấn nút **Install**
4. Đợi cài đặt xong (có thể mất vài phút)

### Bước 4: Kiểm tra
1. Vào **Sketch** → **Include Library**
2. Kiểm tra xem có thấy:
   - ✅ ESP32Servo
   - ✅ Firebase ESP32 Client

---

## 📥 CÁCH 2: CÀI THỦ CÔNG QUA GITHUB

### Cài ESP32Servo:
1. Vào: https://github.com/madhephaestus/ESP32Servo
2. Nhấn nút **Code** → **Download ZIP**
3. Trong Arduino IDE: **Sketch** → **Include Library** → **Add .ZIP Library...**
4. Chọn file ZIP vừa tải
5. Đợi cài đặt xong

### Cài Firebase ESP Client:
1. Vào: https://github.com/mobizt/Firebase-ESP32
2. Nhấn nút **Code** → **Download ZIP**
3. Trong Arduino IDE: **Sketch** → **Include Library** → **Add .ZIP Library...**
4. Chọn file ZIP vừa tải
5. Đợi cài đặt xong

---

## 🔍 KIỂM TRA CÀI ĐẶT

### Test 1: Kiểm tra ESP32Servo
Tạo file test đơn giản:

```cpp
#include <ESP32Servo.h>

Servo myServo;

void setup() {
  Serial.begin(115200);
  myServo.attach(2);
  Serial.println("ESP32Servo OK!");
}

void loop() {
  myServo.write(90);
  delay(1000);
  myServo.write(0);
  delay(1000);
}
```

Nếu compile không lỗi → ✅ ESP32Servo đã cài đúng!

### Test 2: Kiểm tra Firebase
Tạo file test đơn giản:

```cpp
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

void setup() {
  Serial.begin(115200);
  Serial.println("Firebase ESP Client OK!");
}

void loop() {
}
```

Nếu compile không lỗi → ✅ Firebase ESP Client đã cài đúng!

---

## ⚠️ XỬ LÝ LỖI

### ❌ Lỗi: "No such file or directory"
**Nguyên nhân:** Thư viện chưa được cài đặt hoặc đường dẫn sai

**Giải pháp:**
1. Kiểm tra lại đã cài thư viện chưa
2. Restart Arduino IDE
3. Kiểm tra Board Manager đã cài ESP32 chưa

### ❌ Lỗi: "Multiple libraries found"
**Nguyên nhân:** Có nhiều phiên bản thư viện

**Giải pháp:**
1. Xóa các thư viện cũ
2. Cài lại thư viện mới nhất

### ❌ Lỗi: "Board not found"
**Nguyên nhân:** Chưa cài ESP32 Board Support

**Giải pháp:**
1. Vào **File** → **Preferences**
2. Thêm URL: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Vào **Tools** → **Board** → **Boards Manager**
4. Tìm "ESP32" và cài đặt

---

## 📋 CHECKLIST

- [ ] ✅ Đã cài ESP32 Board Support
- [ ] ✅ Đã cài ESP32Servo library
- [ ] ✅ Đã cài Firebase ESP32 Client library
- [ ] ✅ Code compile không lỗi
- [ ] ✅ Upload code lên ESP32 thành công

---

## 🎯 SAU KHI CÀI XONG

1. **Mở file `test_components.ino`**
2. **Compile** (Ctrl + R) để kiểm tra
3. Nếu không lỗi → ✅ Sẵn sàng test phần cứng!

**Chúc bạn cài đặt thành công! 🚀**






















