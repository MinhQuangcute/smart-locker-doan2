/*
 * FILE TEST CÁC LINH KIỆN CƠ BẢN
 * Chỉ test LED, Servo, Solenoid, Reed Switch - KHÔNG có Firebase
 * Compile nhanh hơn!
 */

#include <WiFi.h>
#include <ESP32Servo.h>

// Pin definitions
#define SERVO_PIN 2
#define LED_RED_PIN 4
#define LED_GREEN_PIN 5
#define LED_BLUE_PIN 18
#define SOLENOID_PIN 12
#define REED_PIN 13

// Objects
Servo lockerServo;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n========================================");
  Serial.println("🧪 TEST COMPONENTS - SMART LOCKER");
  Serial.println("========================================");
  Serial.println();
  
  // Initialize pins
  pinMode(LED_RED_PIN, OUTPUT);
  pinMode(LED_GREEN_PIN, OUTPUT);
  pinMode(LED_BLUE_PIN, OUTPUT);
  pinMode(SOLENOID_PIN, OUTPUT);
  pinMode(REED_PIN, INPUT_PULLUP);
  
  lockerServo.attach(SERVO_PIN);
  
  // Turn off all outputs initially
  digitalWrite(LED_RED_PIN, LOW);
  digitalWrite(LED_GREEN_PIN, LOW);
  digitalWrite(LED_BLUE_PIN, LOW);
  digitalWrite(SOLENOID_PIN, LOW);
  lockerServo.write(0);
  
  Serial.println("✅ Tất cả pins đã được khởi tạo");
  Serial.println();
  Serial.println("📋 CÁC LỆNH TEST:");
  Serial.println("  'led'      - Test tất cả LED");
  Serial.println("  'servo'    - Test Servo (0° → 90° → 0°)");
  Serial.println("  'solenoid' - Test Solenoid (kích 500ms)");
  Serial.println("  'reed'     - Test Reed Switch");
  Serial.println("  'wifi'     - Test WiFi connection");
  Serial.println("  'all'      - Test tất cả components");
  Serial.println();
  Serial.println("💡 Gửi lệnh qua Serial Monitor...");
  Serial.println();
}

void loop() {
  if (Serial.available() > 0) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    command.toLowerCase();
    
    Serial.println("📨 Nhận lệnh: " + command);
    Serial.println();
    
    if (command == "led") {
      testLED();
    }
    else if (command == "servo") {
      testServo();
    }
    else if (command == "solenoid") {
      testSolenoid();
    }
    else if (command == "reed") {
      testReedSwitch();
    }
    else if (command == "wifi") {
      testWiFi();
    }
    else if (command == "all") {
      testAll();
    }
    else {
      Serial.println("❌ Lệnh không hợp lệ!");
      Serial.println("💡 Gửi 'led', 'servo', 'solenoid', 'reed', 'wifi', hoặc 'all'");
    }
    
    Serial.println();
    Serial.println("💡 Gửi lệnh tiếp theo...");
    Serial.println();
  }
  
  delay(100);
}

// Test LED
void testLED() {
  Serial.println("💡 TEST LED...");
  
  // Test LED Đỏ
  Serial.println("🔴 Test LED Đỏ (GPIO 4)...");
  digitalWrite(LED_RED_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_RED_PIN, LOW);
  delay(500);
  
  // Test LED Xanh
  Serial.println("🟢 Test LED Xanh (GPIO 5)...");
  digitalWrite(LED_GREEN_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_GREEN_PIN, LOW);
  delay(500);
  
  // Test LED Xanh dương
  Serial.println("🔵 Test LED Xanh dương (GPIO 18)...");
  digitalWrite(LED_BLUE_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_BLUE_PIN, LOW);
  delay(500);
  
  // Test tất cả cùng lúc
  Serial.println("🌈 Test tất cả LED cùng lúc...");
  for (int i = 0; i < 5; i++) {
    digitalWrite(LED_RED_PIN, HIGH);
    digitalWrite(LED_GREEN_PIN, HIGH);
    digitalWrite(LED_BLUE_PIN, HIGH);
    delay(200);
    digitalWrite(LED_RED_PIN, LOW);
    digitalWrite(LED_GREEN_PIN, LOW);
    digitalWrite(LED_BLUE_PIN, LOW);
    delay(200);
  }
  
  Serial.println("✅ Test LED hoàn tất!");
}

// Test Servo
void testServo() {
  Serial.println("⚙️ TEST SERVO...");
  
  Serial.println("🔒 Di chuyển về 0° (đóng)...");
  lockerServo.write(0);
  delay(1000);
  
  Serial.println("🔓 Di chuyển về 90° (mở)...");
  for (int pos = 0; pos <= 90; pos += 10) {
    lockerServo.write(pos);
    Serial.println("   Vị trí: " + String(pos) + "°");
    delay(200);
  }
  delay(2000);
  
  Serial.println("🔒 Di chuyển về 0° (đóng)...");
  for (int pos = 90; pos >= 0; pos -= 10) {
    lockerServo.write(pos);
    Serial.println("   Vị trí: " + String(pos) + "°");
    delay(200);
  }
  
  Serial.println("✅ Test Servo hoàn tất!");
}

// Test Solenoid
void testSolenoid() {
  Serial.println("🔩 TEST SOLENOID...");
  
  Serial.println("🔩 Kích Solenoid (500ms)...");
  digitalWrite(SOLENOID_PIN, HIGH);
  delay(500);
  digitalWrite(SOLENOID_PIN, LOW);
  
  Serial.println("✅ Test Solenoid hoàn tất!");
  Serial.println("💡 Nếu nghe tiếng 'click' → Solenoid hoạt động tốt!");
}

// Test Reed Switch
void testReedSwitch() {
  Serial.println("🧲 TEST REED SWITCH...");
  
  Serial.println("📊 Đọc giá trị trong 10 giây...");
  Serial.println("💡 Đưa nam châm gần/xa Reed Switch để test");
  Serial.println();
  
  for (int i = 0; i < 20; i++) {
    bool doorClosed = (digitalRead(REED_PIN) == LOW);
    String status = doorClosed ? "ĐÓNG" : "MỞ";
    String pinState = doorClosed ? "LOW" : "HIGH";
    
    Serial.println("   Lần " + String(i+1) + ": " + status + " (GPIO 13 = " + pinState + ")");
    delay(500);
  }
  
  Serial.println("✅ Test Reed Switch hoàn tất!");
  Serial.println("💡 LOW = Đóng, HIGH = Mở (với INPUT_PULLUP)");
}

// Test WiFi
void testWiFi() {
  Serial.println("📡 TEST WIFI...");
  Serial.println("⚠️ Cần cấu hình SSID và Password trong code!");
  Serial.println();
  Serial.println("💡 Để test WiFi, sửa dòng 8-9 trong code:");
  Serial.println("   #define WIFI_SSID \"Tên WiFi\"");
  Serial.println("   #define WIFI_PASSWORD \"Mật khẩu\"");
  Serial.println();
  Serial.println("✅ Test WiFi bỏ qua (cần cấu hình)");
}

// Test tất cả
void testAll() {
  Serial.println("🚀 TEST TẤT CẢ COMPONENTS...");
  Serial.println();
  
  testLED();
  delay(2000);
  
  testServo();
  delay(2000);
  
  testSolenoid();
  delay(2000);
  
  testReedSwitch();
  
  Serial.println();
  Serial.println("✅ HOÀN TẤT TEST TẤT CẢ COMPONENTS!");
  Serial.println("📊 Kiểm tra kết quả ở trên để xác định component nào có vấn đề");
}
