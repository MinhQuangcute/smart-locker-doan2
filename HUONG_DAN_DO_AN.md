# 🎓 HƯỚNG DẪN ĐỒ ÁN TỐT NGHIỆP
## Hệ thống Tủ khóa Thông minh với ESP32 và Firebase

---

## 🎯 **FLOW ĐỒ ÁN ĐƠN GIẢN**

```
📱 Quét QR Code → 🌐 Web Interface → 🔘 Ấn nút điều khiển → 🔒 ESP32 thực hiện
```

### **Bước 1: Quét QR Code**
- Mở `simple_control.html` trên điện thoại/máy tính
- Ấn nút "Bắt đầu quét QR"
- Hệ thống sẽ mô phỏng quét QR và kết nối với tủ khóa

### **Bước 2: Điều khiển qua Web**
- **Nút MỞ TỦ** - Mở tủ khóa
- **Nút ĐÓNG TỦ** - Đóng tủ khóa  
- **Nút GIỮ TỦ** - Giữ tủ ở trạng thái hiện tại

### **Bước 3: ESP32 thực hiện**
- ESP32 đọc lệnh từ Firebase
- Điều khiển servo mở/đóng tủ
- Cập nhật trạng thái lên Firebase

---

## 🚀 **CÁCH CHẠY HỆ THỐNG**

### **1. Chuẩn bị Backend (Node.js)**
```bash
# Vào thư mục backend
cd adruino-backend

# Cài đặt dependencies
npm install

# Tạo file .env từ template
copy env.example .env

# Cấu hình .env với thông tin Firebase của bạn
# FIREBASE_PROJECT_ID=minhquang-36ee2
# FIREBASE_DATABASE_URL=https://minhquang-36ee2-default-rtdb.firebaseio.com
# JWT_SECRET=your-secret-key

# Chạy backend
npm start
```

### **2. Chuẩn bị ESP32**
```bash
# Mở Arduino IDE
# Upload file smart_locker.ino lên ESP32
# Cấu hình WiFi và Firebase credentials trong code
```

### **3. Chạy Web Interface**
```bash
# Mở file simple_control.html trong trình duyệt
# Hoặc dùng Live Server extension trong VS Code
```

### **4. Test hệ thống**
1. Mở `simple_control.html`
2. Ấn "Bắt đầu quét QR" 
3. Ấn các nút điều khiển (Mở/Đóng/Giữ)
4. Quan sát ESP32 thực hiện lệnh

---

## 📁 **CẤU TRÚC FILE QUAN TRỌNG**

```
📦 Hệ thống Tủ khóa Thông minh/
├── 🌐 Web Interface
│   ├── simple_control.html     # Giao diện điều khiển chính
│   ├── simple_control.js       # Logic điều khiển
│   ├── index.html              # Dashboard admin
│   ├── shipper.html            # Giao diện shipper
│   ├── receiver.html           # Giao diện receiver
│   └── style.css               # CSS styling
│
├── 🔧 Backend Server
│   ├── adruino-backend/
│   │   ├── server.js           # Node.js backend API
│   │   ├── package.json        # Dependencies
│   │   └── env.example         # Cấu hình mẫu
│
├── 🔌 ESP32 Code
│   └── smart_locker.ino        # Code Arduino cho ESP32
│
└── 📋 Configuration
    ├── firebase_rules.json     # Firebase security rules
    └── setup.sh               # Script cài đặt
```

---

## 🎨 **DEMO CHO ĐỒ ÁN**

### **Tính năng chính:**
1. **Quét QR Code** - Kết nối với tủ khóa
2. **Điều khiển từ xa** - Mở/đóng/giữ tủ qua web
3. **Real-time status** - Hiển thị trạng thái tủ real-time
4. **Activity log** - Ghi lại lịch sử hoạt động
5. **Responsive design** - Hoạt động trên mobile và desktop

### **Công nghệ sử dụng:**
- **Frontend:** HTML5, CSS3, JavaScript ES6
- **Backend:** Node.js, Express.js
- **Database:** Firebase Realtime Database
- **Hardware:** ESP32, Servo Motor, LED, Reed Switch
- **Communication:** WiFi, Firebase SDK

---

## 🔧 **CẤU HÌNH QUAN TRỌNG**

### **Firebase Configuration:**
```javascript
const firebaseConfig = {
    apiKey: "AIzaSyBqfcOprdE5MT6m1yfXmRDtCzngtX86-7U",
    authDomain: "minhquang-36ee2.firebaseapp.com",
    databaseURL: "https://minhquang-36ee2-default-rtdb.firebaseio.com",
    projectId: "minhquang-36ee2",
    storageBucket: "minhquang-36ee2.firebasestorage.app",
    messagingSenderId: "986858991599",
    appId: "1:986858991599:web:53c36493204131a10c501a"
};
```

### **ESP32 WiFi Configuration:**
```cpp
#define WIFI_SSID "Your_WiFi_Name"
#define WIFI_PASSWORD "Your_WiFi_Password"
```

---

## 🎯 **ĐIỂM NỔI BẬT CHO ĐỒ ÁN**

1. **Kiến trúc hiện đại** - Web → Backend → Firebase → ESP32
2. **Bảo mật cao** - JWT authentication, Firebase security rules
3. **Real-time** - Cập nhật trạng thái real-time
4. **Responsive** - Hoạt động trên mọi thiết bị
5. **Scalable** - Dễ mở rộng nhiều tủ khóa
6. **User-friendly** - Giao diện đơn giản, dễ sử dụng

---

## 🚨 **LƯU Ý QUAN TRỌNG**

1. **Cấu hình Firebase** - Đảm bảo project Firebase đã được tạo
2. **WiFi credentials** - Cập nhật SSID và password trong ESP32 code
3. **Service Account** - Tải serviceAccountKey.json từ Firebase Console
4. **Port conflicts** - Đảm bảo port 3000 không bị chiếm dụng
5. **Firebase Rules** - Deploy firebase_rules.json lên Firebase Console

---

## 📞 **HỖ TRỢ**

Nếu gặp vấn đề, kiểm tra:
1. Console log trong trình duyệt (F12)
2. Serial monitor của ESP32
3. Firebase Console → Realtime Database
4. Network tab để xem API calls

**Chúc bạn bảo vệ đồ án thành công! 🎉**

































