# 🔧 HƯỚNG DẪN TEST PHẦN CỨNG ARDUINO

## 📋 CHUẨN BỊ

### 1. Phần cứng cần có:
- ✅ ESP32 Development Board
- ✅ Servo Motor (SG90 hoặc tương đương)
- ✅ Solenoid Lock (12V) + Transistor/MOSFET
- ✅ Reed Switch (cảm biến cửa)
- ✅ 3 LED (Đỏ, Xanh, Xanh dương) + Resistor 220Ω
- ✅ Breadboard và dây nối
- ✅ Nguồn 5V cho ESP32
- ✅ Nguồn 12V cho Solenoid (nếu cần)

### 2. Kết nối phần cứng:

```
ESP32 Pin    →    Component
─────────────────────────────────
GPIO 2       →    Servo Signal (Cam)
GPIO 4       →    LED Đỏ (qua 220Ω)
GPIO 5       →    LED Xanh (qua 220Ω)
GPIO 18      →    LED Xanh dương (qua 220Ω)
GPIO 12      →    Solenoid (qua Transistor/MOSFET)
GPIO 13      →    Reed Switch
5V           →    Servo VCC
GND         →    Common Ground
```

## 🧪 BƯỚC 1: TEST SERIAL MONITOR

### Mục đích: Kiểm tra ESP32 hoạt động và Serial communication

1. **Mở Arduino IDE**
2. **Upload code `smart_locker.ino`**
3. **Mở Serial Monitor** (115200 baud)
4. **Quan sát output:**

```
✅ WiFi đã kết nối!
📡 IP: 192.168.x.x
🔗 Kết nối Firebase thành công!
💡 LED đã khởi tạo
🔒 Servo đã khởi tạo - Tủ đang đóng
🔩 Solenoid đã khởi tạo - OFF
🧲 Cảm biến cửa (Reed) đã khởi tạo
🚀 Hệ thống tủ khóa đã sẵn sàng!
```

**✅ Nếu thấy các dòng trên → ESP32 hoạt động tốt!**

---

## 📡 BƯỚC 2: TEST WIFI

### Mục đích: Kiểm tra kết nối WiFi

1. **Kiểm tra Serial Monitor:**
   - Tìm dòng: `✅ WiFi đã kết nối!`
   - Kiểm tra IP address: `📡 IP: 192.168.x.x`

2. **Nếu không kết nối được:**
   - Kiểm tra SSID và Password trong code (dòng 8-9)
   - Đảm bảo WiFi 2.4GHz (ESP32 không hỗ trợ 5GHz)
   - Kiểm tra khoảng cách đến router

**✅ Nếu thấy IP address → WiFi OK!**

---

## 🔗 BƯỚC 3: TEST FIREBASE CONNECTION

### Mục đích: Kiểm tra kết nối Firebase Realtime Database

1. **Kiểm tra Serial Monitor:**
   - Tìm dòng: `🔗 Kết nối Firebase thành công!`

2. **Kiểm tra Firebase Console:**
   - Mở: https://console.firebase.google.com
   - Vào Realtime Database
   - Kiểm tra node `Locker1` có được tạo không
   - Kiểm tra các field:
     - `status`: "closed" hoặc "open"
     - `current_status`: "closed" hoặc "open"
     - `door_sensor`: "closed" hoặc "open"
     - `last_update`: timestamp

3. **Test ghi dữ liệu từ web:**
   - Mở `simple_control.html` hoặc `index.html`
   - Nhấn nút "Mở tủ" hoặc "Đóng tủ"
   - Quan sát Serial Monitor: `📨 Nhận lệnh mới: open/close`

**✅ Nếu thấy dữ liệu trong Firebase → Firebase OK!**

---

## 💡 BƯỚC 4: TEST LED

### Mục đích: Kiểm tra LED hoạt động

1. **Quan sát LED khi khởi động:**
   - LED đỏ, xanh, xanh dương sẽ nhấp nháy 3 lần (hiệu ứng khởi động)
   - Sau đó LED đỏ sáng (tủ đóng)

2. **Test từng LED:**
   - **LED Đỏ (GPIO 4):** Sáng khi tủ đóng
   - **LED Xanh (GPIO 5):** Sáng khi tủ mở
   - **LED Xanh dương (GPIO 18):** Sáng khi WiFi/Firebase kết nối

3. **Test hiệu ứng:**
   - Mở tủ từ web → LED xanh nhấp nháy 3 lần
   - Đóng tủ từ web → LED đỏ nhấp nháy 3 lần

**✅ Nếu LED sáng đúng → LED OK!**

---

## ⚙️ BƯỚC 5: TEST SERVO

### Mục đích: Kiểm tra Servo motor hoạt động

1. **Quan sát khi khởi động:**
   - Servo sẽ di chuyển về vị trí 0 độ (đóng)

2. **Test mở tủ:**
   - Gửi lệnh "open" từ web
   - Quan sát Serial Monitor: `🔓 Đang mở tủ...`
   - Servo sẽ di chuyển từ 0° → 90° (mở)
   - Sau 10 giây tự động đóng lại

3. **Test đóng tủ:**
   - Gửi lệnh "close" từ web
   - Quan sát Serial Monitor: `🔒 Đang đóng tủ...`
   - Servo sẽ di chuyển từ 90° → 0° (đóng)

**✅ Nếu Servo di chuyển mượt mà → Servo OK!**

**⚠️ Lưu ý:**
- Đảm bảo Servo có nguồn đủ (5V, 1A trở lên)
- Nếu Servo không quay, kiểm tra nguồn và dây nối

---

## 🔩 BƯỚC 6: TEST SOLENOID

### Mục đích: Kiểm tra Solenoid lock hoạt động

1. **Quan sát Serial Monitor khi mở tủ:**
   - Tìm dòng: `🔩 Kích solenoid...`
   - Solenoid sẽ kích trong 300ms

2. **Test thủ công:**
   - Có thể test bằng cách gửi lệnh "open" từ web
   - Nghe tiếng "click" của solenoid khi kích

3. **Kiểm tra mạch:**
   - Solenoid cần nguồn 12V riêng
   - GPIO 12 điều khiển qua Transistor/MOSFET
   - Đảm bảo có diode bảo vệ ngược dòng

**✅ Nếu nghe tiếng "click" → Solenoid OK!**

**⚠️ Lưu ý:**
- Solenoid cần nguồn 12V, không dùng 5V từ ESP32
- Sử dụng Transistor (2N2222) hoặc MOSFET (IRF520) để điều khiển

---

## 🧲 BƯỚC 7: TEST REED SWITCH

### Mục đích: Kiểm tra cảm biến cửa

1. **Kiểm tra Serial Monitor:**
   - Tìm dòng: `🧲 Cảm biến cửa (Reed) đã khởi tạo`
   - Mỗi giây sẽ gửi trạng thái lên Firebase

2. **Test thủ công:**
   - **Khi cửa đóng:** Đưa nam châm gần Reed Switch → GPIO 13 = LOW
   - **Khi cửa mở:** Đưa nam châm xa Reed Switch → GPIO 13 = HIGH

3. **Kiểm tra Firebase:**
   - Field `door_sensor` sẽ cập nhật: "closed" hoặc "open"
   - Kiểm tra trong Firebase Console

**✅ Nếu trạng thái cập nhật đúng → Reed Switch OK!**

**⚠️ Lưu ý:**
- Reed Switch dùng INPUT_PULLUP, nên logic đảo ngược
- LOW = đóng, HIGH = mở (tùy cách lắp đặt)

---

## 🌐 BƯỚC 8: TEST TÍCH HỢP VỚI WEB

### Mục đích: Kiểm tra toàn bộ hệ thống hoạt động

1. **Mở `simple_control.html` hoặc `index.html`**

2. **Test mở tủ:**
   - Nhấn nút "Mở tủ"
   - Quan sát:
     - ✅ Serial Monitor: `📨 Nhận lệnh mới: open`
     - ✅ LED xanh nhấp nháy
     - ✅ Servo quay 90°
     - ✅ Solenoid kích
     - ✅ LED xanh sáng
     - ✅ Firebase cập nhật: `status = "open"`

3. **Test đóng tủ:**
   - Nhấn nút "Đóng tủ"
   - Quan sát:
     - ✅ Serial Monitor: `📨 Nhận lệnh mới: close`
     - ✅ LED đỏ nhấp nháy
     - ✅ Servo quay về 0°
     - ✅ LED đỏ sáng
     - ✅ Firebase cập nhật: `status = "closed"`

4. **Test tự động đóng:**
   - Mở tủ
   - Đợi 10 giây
   - Tủ sẽ tự động đóng lại

**✅ Nếu tất cả hoạt động → Hệ thống hoàn chỉnh!**

---

## 🔍 BƯỚC 9: TEST VỚI BACKEND API

### Mục đích: Kiểm tra tích hợp với backend authentication

1. **Khởi động backend:**
   ```powershell
   cd adruino-backend
   node server.js
   ```

2. **Đăng nhập vào web:**
   - Mở `login.html`
   - Đăng nhập với số điện thoại
   - Mở `simple_control.html` hoặc `index.html`

3. **Test gửi lệnh qua API:**
   - Nhấn nút điều khiển
   - Backend sẽ gửi lệnh lên Firebase
   - ESP32 đọc và thực thi

4. **Kiểm tra log:**
   - Backend log: `Command sent: open/close`
   - Serial Monitor: `📨 Nhận lệnh mới: open/close`

**✅ Nếu hoạt động → Tích hợp backend OK!**

---

## 🐛 XỬ LÝ LỖI THƯỜNG GẶP

### ❌ Lỗi: WiFi không kết nối
- **Nguyên nhân:** SSID/Password sai, WiFi 5GHz
- **Giải pháp:** Kiểm tra lại SSID/Password, dùng WiFi 2.4GHz

### ❌ Lỗi: Firebase không kết nối
- **Nguyên nhân:** API_KEY hoặc DATABASE_URL sai
- **Giải pháp:** Kiểm tra lại trong Firebase Console

### ❌ Lỗi: Servo không quay
- **Nguyên nhân:** Nguồn không đủ, dây nối sai
- **Giải pháp:** Dùng nguồn 5V riêng, kiểm tra dây nối

### ❌ Lỗi: Solenoid không kích
- **Nguyên nhân:** Nguồn 12V chưa kết nối, Transistor hỏng
- **Giải pháp:** Kiểm tra nguồn 12V, thay Transistor

### ❌ Lỗi: Reed Switch không hoạt động
- **Nguyên nhân:** Dây nối sai, nam châm yếu
- **Giải pháp:** Kiểm tra dây nối, dùng nam châm mạnh hơn

---

## 📊 CHECKLIST TEST

- [ ] ✅ ESP32 khởi động và Serial Monitor hoạt động
- [ ] ✅ WiFi kết nối thành công
- [ ] ✅ Firebase kết nối và ghi/đọc dữ liệu
- [ ] ✅ LED đỏ/xanh/xanh dương hoạt động
- [ ] ✅ Servo quay mượt mà (0° ↔ 90°)
- [ ] ✅ Solenoid kích khi mở tủ
- [ ] ✅ Reed Switch phát hiện cửa đóng/mở
- [ ] ✅ Web interface điều khiển được tủ
- [ ] ✅ Tự động đóng sau 10 giây
- [ ] ✅ Backend API tích hợp hoạt động

---

## 🎯 KẾT QUẢ MONG ĐỢI

Sau khi test xong, bạn sẽ có:
- ✅ ESP32 kết nối WiFi và Firebase ổn định
- ✅ LED hiển thị trạng thái rõ ràng
- ✅ Servo mở/đóng tủ mượt mà
- ✅ Solenoid hỗ trợ mở khóa
- ✅ Reed Switch phát hiện trạng thái cửa
- ✅ Web interface điều khiển hoàn chỉnh
- ✅ Tích hợp với backend authentication

**Chúc bạn test thành công! 🚀**






















