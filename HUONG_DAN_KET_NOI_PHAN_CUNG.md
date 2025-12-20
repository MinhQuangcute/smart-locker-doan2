# 🔌 HƯỚNG DẪN KẾT NỐI PHẦN CỨNG SMART LOCKER

## 📦 DANH SÁCH LINH KIỆN CẦN THIẾT

### Linh kiện chính:
- ✅ **ESP32 Development Board** (1 cái)
- ✅ **Servo Motor SG90** (1 cái) - hoặc tương đương
- ✅ **Solenoid Lock 12V** (1 cái) - khóa điện từ
- ✅ **Reed Switch** (1 cái) - cảm biến cửa từ
- ✅ **LED Đỏ** (1 cái) - 5mm hoặc 3mm
- ✅ **LED Xanh** (1 cái) - 5mm hoặc 3mm
- ✅ **LED Xanh dương** (1 cái) - 5mm hoặc 3mm

### Linh kiện phụ:
- ✅ **Resistor 220Ω** (3 cái) - cho LED
- ✅ **Transistor 2N2222** (1 cái) - hoặc MOSFET IRF520
- ✅ **Resistor 1kΩ** (1 cái) - cho Transistor base
- ✅ **Diode 1N4007** (1 cái) - bảo vệ ngược dòng cho Solenoid
- ✅ **Breadboard** (1 cái) - hoặc PCB
- ✅ **Dây nối** (nhiều sợi)
- ✅ **Nguồn 5V** - cho ESP32 và Servo
- ✅ **Nguồn 12V** - cho Solenoid (riêng biệt)

---

## 🔌 SƠ ĐỒ KẾT NỐI

### Tổng quan:
```
ESP32 Pin    →    Component
─────────────────────────────────────────────
GPIO 2       →    Servo Signal (Cam vàng)
GPIO 4       →    LED Đỏ (qua 220Ω)
GPIO 5       →    LED Xanh (qua 220Ω)
GPIO 18      →    LED Xanh dương (qua 220Ω)
GPIO 12      →    Transistor Base (qua 1kΩ)
GPIO 13      →    Reed Switch (một đầu)
5V           →    Servo VCC (đỏ)
GND          →    Common Ground (tất cả)
```

---

## 💡 KẾT NỐI LED

### LED Đỏ (GPIO 4):
```
ESP32 GPIO 4 ──[220Ω]── LED Đỏ (Anode +) ── LED Đỏ (Cathode -) ── GND
```

### LED Xanh (GPIO 5):
```
ESP32 GPIO 5 ──[220Ω]── LED Xanh (Anode +) ── LED Xanh (Cathode -) ── GND
```

### LED Xanh dương (GPIO 18):
```
ESP32 GPIO 18 ──[220Ω]── LED Xanh dương (Anode +) ── LED Xanh dương (Cathode -) ── GND
```

### ⚠️ Lưu ý:
- **Anode (+)** là chân dài hơn, nối với nguồn dương
- **Cathode (-)** là chân ngắn hơn, nối với GND
- **Bắt buộc** dùng resistor 220Ω để bảo vệ LED và ESP32
- Nếu không có resistor, LED sẽ cháy hoặc ESP32 bị hỏng!

---

## ⚙️ KẾT NỐI SERVO MOTOR

### Servo SG90 có 3 dây:
- 🔴 **Đỏ (VCC)** → ESP32 5V
- ⚫ **Đen (GND)** → ESP32 GND
- 🟡 **Vàng (Signal)** → ESP32 GPIO 2

### Sơ đồ:
```
ESP32 5V  ── Servo VCC (đỏ)
ESP32 GND ── Servo GND (đen)
ESP32 GPIO 2 ── Servo Signal (vàng)
```

### ⚠️ Lưu ý:
- Servo cần nguồn 5V, 1A trở lên
- Nếu Servo không quay, có thể do nguồn yếu
- Có thể dùng nguồn 5V riêng cho Servo (nhưng phải chung GND với ESP32)

---

## 🔩 KẾT NỐI SOLENOID LOCK

### Solenoid cần mạch điều khiển vì dòng cao (12V, 1-2A)

### Sơ đồ mạch:
```
ESP32 GPIO 12 ──[1kΩ]── Transistor Base (2N2222)
                                    │
                                    ├── Transistor Emitter ── GND
                                    │
                                    └── Transistor Collector ── Solenoid (-)
                                                                    │
                                                                    └── Diode 1N4007 (ngược)
                                                                    │
                                                                    └── Solenoid (+) ── Nguồn 12V (+)
                                                                    │
                                                                    └── Nguồn 12V (-) ── GND
```

### Chi tiết kết nối:
1. **ESP32 GPIO 12** → Resistor 1kΩ → **Transistor Base (chân giữa)**
2. **Transistor Emitter** → **GND** (chân bên trái)
3. **Transistor Collector** → **Solenoid (-)** (chân bên phải)
4. **Solenoid (+)** → **Nguồn 12V (+)**
5. **Nguồn 12V (-)** → **GND** (chung với ESP32)
6. **Diode 1N4007**: Nối ngược giữa Collector và Emitter
   - Vạch trắng (Cathode) → Collector
   - Đầu còn lại (Anode) → Emitter

### ⚠️ Lưu ý:
- **Bắt buộc** dùng Transistor hoặc MOSFET để điều khiển Solenoid
- GPIO ESP32 chỉ chịu được 40mA, Solenoid cần 1-2A
- **Bắt buộc** dùng Diode để bảo vệ ngược dòng khi Solenoid tắt
- Nguồn 12V phải riêng biệt, không dùng 5V từ ESP32
- Phải chung GND giữa ESP32 và nguồn 12V

### Thay thế Transistor bằng MOSFET:
Nếu dùng MOSFET IRF520:
```
ESP32 GPIO 12 ──[10kΩ]── MOSFET Gate
                            │
                            ├── MOSFET Source ── GND
                            │
                            └── MOSFET Drain ── Solenoid (-)
```

---

## 🧲 KẾT NỐI REED SWITCH

### Reed Switch có 2 dây:
- Một dây → ESP32 GPIO 13
- Một dây → ESP32 GND

### Sơ đồ:
```
ESP32 GPIO 13 ── Reed Switch (một đầu)
ESP32 GND ── Reed Switch (đầu còn lại)
```

### ⚠️ Lưu ý:
- Code dùng `INPUT_PULLUP`, nên logic đảo ngược:
  - **LOW** = Cửa đóng (nam châm gần)
  - **HIGH** = Cửa mở (nam châm xa)
- Đặt nam châm trên cửa, Reed Switch trên khung
- Khi cửa đóng → nam châm gần Reed Switch → GPIO 13 = LOW

---

## 🔋 KẾT NỐI NGUỒN

### Nguồn cho ESP32:
- **USB 5V** (qua cổng USB) - đủ cho ESP32
- Hoặc **Nguồn ngoài 5V** → ESP32 VIN pin

### Nguồn cho Servo:
- **Cùng nguồn 5V với ESP32** (nếu nguồn đủ mạnh ≥1A)
- Hoặc **Nguồn 5V riêng** (nhưng phải chung GND)

### Nguồn cho Solenoid:
- **Nguồn 12V riêng** (Adapter 12V, 2A trở lên)
- **Bắt buộc** chung GND với ESP32

### Sơ đồ nguồn:
```
Nguồn 5V ── ESP32 VIN
         └── Servo VCC
         └── GND (chung)

Nguồn 12V ── Solenoid (+)
         └── GND (chung với ESP32)
```

---

## 📐 SƠ ĐỒ TỔNG HỢP (BREADBOARD)

### Bố trí trên Breadboard:

```
                    [BREADBOARD]
                    
[ESP32]            [LED Đỏ]    [LED Xanh]   [LED Xanh dương]
  │                  │            │              │
  │ GPIO 4 ──────────┼────────────┼──────────────┼──[220Ω]── LED Đỏ
  │ GPIO 5 ──────────┼────────────┼──────────────┼──[220Ω]── LED Xanh
  │ GPIO 18 ─────────┼────────────┼──────────────┼──[220Ω]── LED Xanh dương
  │ GPIO 2 ──────────────────────────────────────────────── Servo Signal
  │ GPIO 12 ───[1kΩ]── Transistor Base
  │ GPIO 13 ─────────────────────────────────────────────── Reed Switch
  │ 5V ──────────────────────────────────────────────────── Servo VCC
  │ GND ─────────────────────────────────────────────────── Common GND
  │
  │
[Transistor 2N2222]
  │ Collector ──────────────────────────────────────────── Solenoid (-)
  │ Emitter ─────────────────────────────────────────────── GND
  │
[Diode 1N4007] (ngược giữa Collector và Emitter)

[Solenoid]
  │ (+) ─────────────────────────────────────────────────── Nguồn 12V (+)
  │ (-) ─────────────────────────────────────────────────── Transistor Collector
```

---

## 🔧 CÁC BƯỚC LẮP ĐẶT

### Bước 1: Lắp LED
1. Cắm 3 LED vào breadboard
2. Nối resistor 220Ω vào Anode của mỗi LED
3. Nối GPIO 4, 5, 18 vào đầu kia của resistor
4. Nối Cathode của LED vào GND

### Bước 2: Lắp Servo
1. Nối Servo VCC (đỏ) → ESP32 5V
2. Nối Servo GND (đen) → ESP32 GND
3. Nối Servo Signal (vàng) → ESP32 GPIO 2

### Bước 3: Lắp Solenoid
1. Cắm Transistor 2N2222 vào breadboard
2. Nối GPIO 12 → Resistor 1kΩ → Transistor Base
3. Nối Transistor Emitter → GND
4. Nối Transistor Collector → Solenoid (-)
5. Nối Diode 1N4007 ngược giữa Collector và Emitter
6. Nối Solenoid (+) → Nguồn 12V (+)
7. Nối Nguồn 12V (-) → GND

### Bước 4: Lắp Reed Switch
1. Nối một đầu Reed Switch → ESP32 GPIO 13
2. Nối đầu còn lại → ESP32 GND

### Bước 5: Kiểm tra
1. Kiểm tra tất cả kết nối GND đã chung chưa
2. Kiểm tra nguồn 5V và 12V đã đúng chưa
3. Kiểm tra không có dây nào bị chạm nhau

---

## ⚠️ LƯU Ý AN TOÀN

### ⚡ Điện áp:
- ✅ ESP32: 5V (không quá 5.5V)
- ✅ Servo: 5V (có thể dùng 6V nhưng nhanh hỏng)
- ✅ Solenoid: 12V (không quá 12V)

### 🔥 Dòng điện:
- ✅ ESP32 GPIO: Tối đa 40mA mỗi pin
- ✅ Servo: 500mA - 1A khi quay
- ✅ Solenoid: 1A - 2A khi kích

### 🛡️ Bảo vệ:
- ✅ **Bắt buộc** dùng resistor cho LED
- ✅ **Bắt buộc** dùng Transistor/MOSFET cho Solenoid
- ✅ **Bắt buộc** dùng Diode cho Solenoid
- ✅ **Bắt buộc** chung GND giữa tất cả nguồn

---

## 🐛 XỬ LÝ LỖI THƯỜNG GẶP

### ❌ LED không sáng:
- Kiểm tra resistor đã nối chưa
- Kiểm tra Anode/Cathode đã đúng chưa
- Kiểm tra GPIO đã được set OUTPUT chưa

### ❌ Servo không quay:
- Kiểm tra nguồn 5V đã đủ mạnh chưa (≥1A)
- Kiểm tra dây Signal đã nối đúng GPIO 2 chưa
- Thử dùng nguồn 5V riêng cho Servo

### ❌ Solenoid không kích:
- Kiểm tra nguồn 12V đã có chưa
- Kiểm tra Transistor đã nối đúng chưa
- Kiểm tra Diode đã nối đúng chiều chưa
- Đo điện áp tại Solenoid khi GPIO 12 = HIGH

### ❌ Reed Switch không hoạt động:
- Kiểm tra đã nối đúng GPIO 13 và GND chưa
- Kiểm tra nam châm đã đủ mạnh chưa
- Đo điện áp tại GPIO 13 khi đưa nam châm gần/xa

---

## 📊 CHECKLIST KẾT NỐI

- [ ] ✅ LED Đỏ nối GPIO 4 qua 220Ω
- [ ] ✅ LED Xanh nối GPIO 5 qua 220Ω
- [ ] ✅ LED Xanh dương nối GPIO 18 qua 220Ω
- [ ] ✅ Servo VCC → 5V, GND → GND, Signal → GPIO 2
- [ ] ✅ Solenoid nối qua Transistor và Diode
- [ ] ✅ Solenoid nối nguồn 12V riêng
- [ ] ✅ Reed Switch nối GPIO 13 và GND
- [ ] ✅ Tất cả GND đã chung
- [ ] ✅ Nguồn 5V và 12V đã đúng
- [ ] ✅ Không có dây nào chạm nhau

---

## 🎯 SAU KHI KẾT NỐI XONG

1. **Kiểm tra lại tất cả kết nối**
2. **Upload code `test_components.ino`** để test từng component
3. **Kiểm tra Serial Monitor** để xem kết quả
4. **Nếu tất cả OK** → Upload `smart_locker.ino` để chạy hệ thống

**Chúc bạn lắp đặt thành công! 🚀**
































