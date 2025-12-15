// Smart Locker Backend Server
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
// giau secretkey vao .env

const cookieParser = require("cookie-parser");
// cookie-parser: xử lý cookie trong request
// Danh sách tủ logic theo kích thước (demo)
// Thực tế: mỗi lockerId có thể là 1 ngăn tủ thật.
const LOCKERS_BY_SIZE = {
  small: ["S1", "S2"],      // tủ nhỏ
  medium: ["M1", "M2"],     // tủ vừa
  large: ["L1","L2"]             // tủ lớn
};






// =======================
// 0. Cấu hình ROLE (admin theo số điện thoại)
// =======================

// Danh sách số điện thoại admin (chuẩn hoá về dạng 0xxxxxxxxx)
const ADMIN_PHONES = [
  "0976983308", // số admin (bạn sửa lại nếu cần)
  // thêm các số khác nếu cần
];

// Hàm chuẩn hoá SĐT về dạng 0xxxxxxxxx
function normalizePhone(phone) {
  if (!phone) return "";
  phone = phone.toString().replace(/\s+/g, "");
  if (phone.startsWith("+84")) return "0" + phone.slice(3);
  if (phone.startsWith("84")) return "0" + phone.slice(2);
  return phone;
}

// Hàm xác định role dựa trên SĐT
function getRoleForPhone(phoneNumber) {
  const norm = normalizePhone(phoneNumber);
  return ADMIN_PHONES.includes(norm) ? "admin" : "resident";
}
// ket noi firebase

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = JSON.parse(
    fs.readFileSync(path.join(__dirname, "serviceAccountKey.json"), "utf8")
  );
}


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://minhquang-36ee2-default-rtdb.firebaseio.com",
});

const db = admin.database();
function lockerRefById(lockerId) { //doi node firebase thanh lockerid
  if (!lockerId) throw new Error("lockerId is required");
  return db.ref(`/Lockers/${lockerId}`);
}
async function claimLocker(lockerId, reservationId, receiverPhone) {
  const ref = db.ref(`/Lockers/${lockerId}`);

  const result = await ref.transaction((cur) => {
    const current = cur || { status: "idle" };

    // chỉ claim khi idle (và không maintenance)
    if (current.status && current.status !== "idle") return;
    if (current.status === "maintenance") return;

    return {
      ...current,
      status: "booked",
      reservationId,
      reservedBy: receiverPhone,
      last_update: Date.now(),
    };
  });

  return result.committed === true;
}

async function releaseLockerIfMatch(lockerId, reservationId) {
  const ref = db.ref(`/Lockers/${lockerId}`);
  await ref.transaction((cur) => {
    if (!cur) return cur;
    if (cur.reservationId !== reservationId) return; // abort

    return {
      ...cur,
      status: "idle",
      reservationId: null,
      reservedBy: null,
      last_update: Date.now(),
    };
  });
}



// =======================
// 2. Khởi tạo express
// =======================
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());
// cookie-parser: xử lý cookie
const PORT = process.env.PORT ||3000;
const JWT_SECRET = process.env.JWT_SECRET || "bimatnho";


 // nhớ đổi khi lên production
 //process.env.JWT_SECRET: lấy giá trị từ biến môi trường JWT_SECRET.
//Nếu không có (vd: quên set, hoặc đang dev lười tạo .env), thì dùng tạm "dev-secret" cho khỏi crash.
const isProduction = process.env.NODE_ENV === "production";
// production là true nếu NODE_ENV là "production", ngược lại là false.
// =======================
// Phone Auth Configuration
// =======================
const OTP_EXPIRY_MINUTES = 1;
const RESERVATION_EXPIRY_HOURS = 24 * 3;
const PICKUP_OTP_MAX_ATTEMPTS = 5;     // tối đa 5 lần sai
const PICKUP_OTP_LOCK_MINUTES = 5;    // khoá 5 phút
const OTP_SEND_COOLDOWN_SECONDS = 30;
const OTP_LOCK_MINUTES = 3;//otp dangnhap/dangki
const OTP_MAX_ATTEMPTS = 5;



// =======================
// 3. Middleware xác thực jwt
// =======================
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  let token = null;

  // 1) Ưu tiên header Authorization (Postman, debug)
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  // 2) Nếu không có header thì dùng cookie (trình duyệt)
  if (!token && req.cookies && req.cookies.authToken) {
    token = req.cookies.authToken;
  }

  if (!token) {
    return res.status(401).json({ error: "Token missing" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error("JWT verify error:", err);
      return res.status(403).json({ error: "Invalid token" });
    }
    req.user = user;
    next();
  });
}
//Postman vẫn dùng header Authorization: Bearer ... như cũ.
//Web browser thì không cần gắn header, chỉ cần cookie.

//middleware xác thực admin
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ success: false, error: "Admin only" });
  }
  next();
}

// Admin: xem tất cả đơn đặt tủ
app.get("/api/admin/reservations-all", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const snap = await db.ref("/Reservations").once("value");
    const data = snap.val() || {};

    const reservations = Object.entries(data)
      .map(([id, r]) => ({
        id,
        receiverPhone: r.receiverPhone || null,
        lockerId: r.lockerId || "Locker1",
        bookingCode: r.bookingCode || r.otpCode || null,
        status: r.status || "unknown",
        createdAt: r.createdAt || null,
        loadedAt: r.loadedAt || null,
        openedAt: r.openedAt || null,
        expiresAt: r.expiresAt || null,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    res.json({
      success: true,
      reservations,
    });
  } catch (err) {
    console.error("Error getting all reservations (admin):", err);
    res.status(500).json({ success: false, error: "Failed to get reservations" });
  }
});

// Admin: xem log hệ thống
app.get("/api/admin/logs", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const snap = await db.ref("/Logs").limitToLast(200).once("value");
    const data = snap.val() || {};

    const logs = Object.entries(data)
      .map(([id, l]) => ({
        id,
        phone: l.phone || null,
        locker: l.locker || "Locker1",
        action: l.action || "",
        result: l.result || "",
        timestamp: l.timestamp || null,
        reservationId: l.reservationId || null,
      }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    res.json({
      success: true,
      logs,
    });
  } catch (err) {
    console.error("Error getting logs (admin):", err);
    res.status(500).json({ success: false, error: "Failed to get logs" });
  }
});




// =======================
// 4. Phone Authentication APIs
// =======================

// Gửi OTP
app.post("/api/auth/send-otp", async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number required" });
  }

  // Validate phone number format (Vietnamese)
  const phoneRegex = /^(\+84|84|0)[0-9]{9}$/;
  if (!phoneRegex.test(phoneNumber)) {
    return res.status(400).json({ error: "Invalid phone number format" });
  }
  const lastSnap = await db.ref("/OTPs")
  .orderByChild("phoneNumber")
  .equalTo(phoneNumber)
  .limitToLast(1)
  .once("value");

const last = lastSnap.val();
if (last) {
  const [lastId, lastOtp] = Object.entries(last)[0];
  if (lastOtp?.createdAt && (Date.now() - lastOtp.createdAt) < OTP_SEND_COOLDOWN_SECONDS * 1000) {
    return res.status(429).json({ error: "Bạn thao tác quá nhanh, vui lòng thử lại sau 30s" });
  }
}


  try {
    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationId = uuidv4();
    const expiresAt = Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000;
    



    // Store OTP in Firebase
    await db.ref(`/OTPs/${verificationId}`).set({
      phoneNumber: phoneNumber,
      otpCode: otpCode,
      expiresAt: expiresAt,
      createdAt: Date.now(),
      attempts: 0,
  lockedUntil: 0
    });

    // In production, send SMS here
    console.log(`📱 OTP for ${phoneNumber}: ${otpCode}`);
    console.log(`🔑 Verification ID: ${verificationId}`);
    console.log(
      `⏰ Expires at: ${new Date(expiresAt).toLocaleString("vi-VN")}`
    );

    const responseData = {
      success: true,
      verificationId: verificationId,
      message: "OTP sent successfully",
      expiresAt: expiresAt,
    };
    //Chỉ trả otpCode khi KHÔNG phải production (dev, test)
if (!isProduction) {
  responseData.otpCode = otpCode;
}

return res.json(responseData);
  } catch (error) {
    console.error("Error sending OTP:", error);
    return res.status(500).json({ error: "Failed to send OTP" });
  }
});

// Đăng nhập ,dangki bằng OTP (verify + tạo token)
app.post("/api/auth/verify-otp", async (req, res) => {
  const { verificationId, otpCode } = req.body;

  if (!verificationId || !otpCode) {
    return res
      .status(400)
      .json({ error: "Thiếu verificationId hoặc otpCode" });
  }

  try {
    // 1. Lấy OTP từ Firebase
    const otpSnapshot = await db.ref(`/OTPs/${verificationId}`).once("value");
    const otpData = otpSnapshot.val();
    // bị khoá tạm
if (otpData.lockedUntil && Date.now() < otpData.lockedUntil) {
  return res.status(429).json({ error: "Bạn nhập sai quá nhiều lần, vui lòng thử lại sau 3 phút" });
}

    

    if (!otpData) {
      return res
        .status(400)
        .json({ error: "Verification ID không hợp lệ" });
    }

    // 2. Kiểm tra hết hạn
    if (Date.now() > otpData.expiresAt) {
      return res.status(400).json({ error: "OTP đã hết hạn" });
    }

    // 3. Kiểm tra mã OTP
    if (otpData.otpCode !== otpCode) {
      const attempts = (otpData.attempts || 0) + 1;
    
      const update = { attempts };
      if (attempts >= OTP_MAX_ATTEMPTS) {
        update.lockedUntil = Date.now() + OTP_LOCK_MINUTES * 60 * 1000;
      }
    
      await db.ref(`/OTPs/${verificationId}`).update(update);
    
      return res.status(400).json({ error: "Mã OTP không đúng" });
    }
    

    const phoneNumber = otpData.phoneNumber;

    // 4. Lấy thông tin user từ /Users
    const userRef = db.ref(`/Users/${phoneNumber}`);
    const userSnapshot = await userRef.once("value");
    const userData = userSnapshot.val();

    if (!userData) {
      // User chưa đăng ký → không login, yêu cầu đăng ký trước
      return res.status(400).json({
        error: "Số điện thoại này chưa đăng ký tài khoản",
      });
    }

    // 5. Cập nhật lastLogin
    const now = Date.now();
    await userRef.update({ lastLogin: now });

    // 6. Xác định role (ưu tiên logic admin theo phone)
    const role = getRoleForPhone(phoneNumber) || userData.role || "resident";

    // 7. Tạo JWT token có phone + role
    const token = jwt.sign(
      { phoneNumber: phoneNumber, role: role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // 7.1. Set cookie
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

res.cookie("authToken", token, cookieOptions);

    // 8. Xoá OTP vì đã dùng xong
    await db.ref(`/OTPs/${verificationId}`).remove();

    // 9. Trả kết quả cho frontend
    const responseData = {
      success: true,
      phoneNumber: phoneNumber,
      role: role,
      user: { ...userData, lastLogin: now, role },
    };
    
    // Dev thì vẫn trả token cho tiện debug, production thì không
    if (!isProduction) {
      responseData.token = token;
    }
    
    res.json(responseData);
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ error: "Lỗi xác thực OTP" });
  }
});

// Đăng ký user mới
app.post("/api/auth/register", async (req, res) => {
  const { phoneNumber, fullName, verificationId, otpCode, apartment } = req.body;

  if (!phoneNumber || !fullName || !verificationId || !otpCode) {
    return res
      .status(400)
      .json({ error: "All fields required (phone, name, otp...)" });
  }

  try {
    // Verify OTP
    const otpSnapshot = await db.ref(`/OTPs/${verificationId}`).once("value");
    const otpData = otpSnapshot.val();

    if (
      !otpData ||
      otpData.otpCode !== otpCode ||
      Date.now() > otpData.expiresAt
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    // Check if user already exists
    const userRef = db.ref(`/Users/${phoneNumber}`);
    const userSnapshot = await userRef.once("value");
    if (userSnapshot.exists()) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Xác định role theo số điện thoại
    const userRole = getRoleForPhone(phoneNumber);

    // Create user
    const userData = {
      phoneNumber: phoneNumber,
      fullName: fullName,
      apartment: apartment || "",
      role: userRole,
      createdAt: Date.now(),
      lastLogin: Date.now(),
    };

    await userRef.set(userData);

    // Generate JWT token
    const token = jwt.sign(
      { phoneNumber: phoneNumber, role: userData.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Set cookie chứa token
const cookieOptions = {
  httpOnly: true,                 // JS không đọc được
  sameSite: "lax",                // tránh CSRF cơ bản
  secure: isProduction,           // chỉ dùng HTTPS ở production
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 ngày
};

res.cookie("authToken", token, cookieOptions);

    // Clean up OTP
    await db.ref(`/OTPs/${verificationId}`).remove();

    const responseData = {
      success: true,
      user: userData,
    };
    
    // Dev thì vẫn trả token cho tiện debug, production thì không
    if (!isProduction) {
      responseData.token = token;
    }
    
    res.json(responseData);
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ error: "Failed to register user" });
  }
});

// =======================
// 5. API: Gửi lệnh mở/đóng locker
// =======================
app.post("/api/command", authenticateToken, requireAdmin, async (req, res) => {
  const { lockerId, action } = req.body;
  const phoneNumber = req.user.phoneNumber;

  if (!["open", "close"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  try {
    const lockerRef =  lockerRefById(lockerId);
    await lockerRef.update({
      command: action,
      last_update: Date.now(),
    });

    const logRef = db.ref("/Logs").push();
    await logRef.set({
      phone: phoneNumber,
      locker: lockerId,
      action,
      timestamp: Date.now(),
      result: "success",
    });

    res.json({ message: `Command '${action}' sent to ${lockerId}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send command" });
  }
});

// =======================
// 6. API: Lấy trạng thái locker
// =======================
app.get("/api/locker/:id/status", authenticateToken, async (req, res) => {
  const lockerId = req.params.id;
  try {
    const lockerSnapshot = await lockerRefById(lockerId).once("value");
    const lockerData = lockerSnapshot.val();
    res.json(lockerData || { status: "unknown" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get locker status" });
  }
});

// Cư dân đặt tủ trước (có chọn kích thước tủ)
app.post("/api/user/reserve-locker", authenticateToken, async (req, res) => {
  const { lockerSize } = req.body;
  const receiverPhone = req.user.phoneNumber;

  const allowedSizes = ["small", "medium", "large"];
  const size = (lockerSize || "").toLowerCase();

  if (!allowedSizes.includes(size)) {
    return res.status(400).json({
      success: false,
      error: "Locker size không hợp lệ (chỉ chấp nhận: small, medium, large)"
    });
  }

  const candidateLockers = LOCKERS_BY_SIZE[size] || [];
  if (!candidateLockers.length) {
    return res.status(400).json({
      success: false,
      error: "Hiện chưa cấu hình tủ nào cho kích thước này"
    });
  }

  // chuẩn bị dữ liệu reservation trước
  const now = Date.now();
  const reservationId = uuidv4();
  const bookingCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = now + (RESERVATION_EXPIRY_HOURS * 60 * 60 * 1000);

  let lockerId = null;

  try {
    // ✅ Transaction: thử claim lần lượt các tủ trong candidate
    for (const id of candidateLockers) {
      const ok = await claimLocker(id, reservationId, receiverPhone);
      if (ok) {
        lockerId = id;
        break;
      }
    }

    if (!lockerId) {
      return res.status(400).json({
        success: false,
        error: "Hiện không còn tủ trống cho kích thước này"
      });
    }

    // ✅ Ghi reservation sau khi claim thành công
    await db.ref(`/Reservations/${reservationId}`).set({
      receiverPhone,
      lockerId,
      lockerSize: size,
      bookingCode,
      pickupOtp: null,
      status: "booked",
      createdAt: now,
      expiresAt
    });

    // (tuỳ chọn) update lại locker cho đủ field (không bắt buộc vì claimLocker đã set booked)
    await db.ref(`/Lockers/${lockerId}`).update({
      status: "booked",
      last_update: Date.now(),
      reservationId,
      reservedBy: receiverPhone
    });

    return res.json({
      success: true,
      reservationId,
      lockerId,
      lockerSize: size,
      bookingCode,
      expiresAt
    });
  } catch (err) {
    console.error("Error reserving locker:", err);

    // nếu đã claim mà ghi reservation fail -> nhả lại tủ
    if (lockerId) {
      await releaseLockerIfMatch(lockerId, reservationId);
    }

    return res.status(500).json({ success: false, error: "Failed to reserve locker" });
  }
});



// Lấy lịch sử đặt tủ của cư dân (theo số đang đăng nhập)
app.get("/api/user/reservations", authenticateToken, async (req, res) => {
  const phoneNumber = req.user.phoneNumber; // lấy từ token JWT

  try {
    // Lọc tất cả reservation mà người nhận = số điện thoại đang login
    const snap = await db
      .ref("/Reservations")
      .orderByChild("receiverPhone")
      .equalTo(phoneNumber)
      .once("value");

    const data = snap.val() || {};

    // Convert object -> array, sort theo thời gian tạo mới nhất
    const reservations = Object.entries(data)
      .map(([id, r]) => ({
        id,
        lockerId: r.lockerId || "Locker1",
        lockerSize: r.lockerSize || null,   // 🔹 thêm dòng này
        // Nếu bạn dùng bookingCode (đặt tủ trước) thì lấy bookingCode,
        // nếu chưa có thì fallback sang otpCode cho đỡ bị null.
        bookingCode: r.bookingCode || r.otpCode || null,
        status: r.status || "unknown",
        createdAt: r.createdAt || null,
        expiresAt: r.expiresAt || null,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    res.json({
      success: true,
      reservations,
    });
  } catch (err) {
    console.error("Error getting user reservations:", err);
    res.status(500).json({ error: "Failed to get user reservations" });
  }
});

// Shipper dùng mã đặt tủ (bookingCode) để mở tủ và đánh dấu đã bỏ hàng
// Shipper dùng mã đặt tủ (bookingCode) để mở tủ và đánh dấu đã bỏ hàng
app.post("/api/shipper/use-reservation", async (req, res) => {
  const raw = req.body.bookingCode;
  const codeStr = String(raw || "").trim();
  const codeNum = Number(codeStr);

  if (!codeStr) {
    return res.status(400).json({ error: "Booking code required" });
  }

  try {
    // 1) Tìm reservation theo bookingCode (thử string trước)
    let snap = await db
      .ref("/Reservations")
      .orderByChild("bookingCode")
      .equalTo(codeStr)
      .once("value");

    // 2) Nếu không thấy và codeNum hợp lệ -> thử theo number
    if (!snap.exists() && !Number.isNaN(codeNum)) {
      snap = await db
        .ref("/Reservations")
        .orderByChild("bookingCode")
        .equalTo(codeNum)
        .once("value");
    }

    const reservations = snap.val();
    if (!reservations) {
      return res.status(400).json({ error: "Không tìm thấy mã đặt tủ này" });
    }

    // 3) Nếu trùng bookingCode -> chọn đơn booked + chưa hết hạn + mới nhất
    const now = Date.now();
    const entries = Object.entries(reservations).map(([id, r]) => ({ id, r }));

    const candidates = entries
      .filter(({ r }) => r && r.status === "booked" && now <= (r.expiresAt || 0))
      .sort((a, b) => (b.r.createdAt || 0) - (a.r.createdAt || 0));

    if (!candidates.length) {
      const any = entries[0]?.r;
      return res.status(400).json({
        error: `Mã tồn tại nhưng không hợp lệ (trạng thái: ${any?.status || "unknown"}).`,
      });
    }

    const reservationId = candidates[0].id;

    // 4) Transaction: booked -> loaded (chỉ dùng 1 lần)
    const reservationRef = db.ref(`/Reservations/${reservationId}`);
    const pickupOtp = Math.floor(100000 + Math.random() * 900000).toString();

    const tx = await reservationRef.transaction((cur) => {
      if (!cur) return;
      if (now > (cur.expiresAt || 0)) return;
      if (cur.status !== "booked") return;

      return {
        ...cur,
        status: "loaded",
        loadedAt: now,
        pickupOtp,
        otpCode: pickupOtp, // giữ tương thích code cũ
      };
    });

    if (!tx.committed) {
      const latest = (await reservationRef.once("value")).val();

      if (!latest) return res.status(400).json({ error: "Không tìm thấy mã đặt tủ này" });
      if (Date.now() > (latest.expiresAt || 0)) {
        return res.status(400).json({ error: "Đơn đặt tủ đã hết hạn" });
      }
      return res.status(400).json({
        error: `Trạng thái hiện tại: ${latest.status}, không thể dùng mã này.`,
      });
    }

    // 5) Commit xong mới mở tủ
    const updatedReservation = tx.snapshot.val();
    if (!updatedReservation?.lockerId) {
      return res.status(500).json({ error: "Reservation thiếu lockerId" });
    }

    await lockerRefById(updatedReservation.lockerId).update({
      command: "open",
      last_update: Date.now(),
      status: "loaded",
    });

    console.log(`🎯 OTP cho người nhận (${updatedReservation.receiverPhone}): ${pickupOtp}`);

    return res.json({
      success: true,
      lockerId: updatedReservation.lockerId,
      message: "Đã mở tủ cho shipper và tạo OTP cho người nhận.",
    });
  } catch (err) {
    console.error("Error using reservation by shipper:", err);
    return res.status(500).json({ error: "Lỗi xử lý mã đặt tủ cho shipper" });
  }
});


// =======================
// Receiver: nhập OTP để mở tủ
// =======================
app.post("/api/receiver/verify-and-open", authenticateToken, async (req, res) => {
  const { reservationId, otpCode } = req.body;
  const phoneNumber = req.user.phoneNumber;

  if (!reservationId || !otpCode) {
    return res.status(400).json({ error: "Reservation ID và OTP là bắt buộc" });
  }

  try {
    const reservationRef = db.ref(`/Reservations/${reservationId}`);
    const now = Date.now();

    // ✅ Transaction: chặn bấm 2 lần + limit sai OTP
    const tx = await reservationRef.transaction((cur) => {
      if (!cur) return;

      // Đảm bảo đúng người nhận
      if (cur.receiverPhone !== phoneNumber) return;

      // Kiểm tra trạng thái
      if (cur.status !== "loaded") return;

      // Kiểm tra hết hạn
      if (now > (cur.expiresAt || 0)) return;

      // Nếu đang bị khoá do nhập sai nhiều lần
      if (cur.otpLockedUntil && now < cur.otpLockedUntil) return;

      const storedOtp = cur.pickupOtp || cur.otpCode;

      // Sai OTP -> tăng attempts và có thể khoá
      if (!storedOtp || storedOtp !== otpCode) {
        const nextAttempts = (cur.otpAttempts || 0) + 1;

        const patched = {
          ...cur,
          otpAttempts: nextAttempts,
        };

        if (nextAttempts >= PICKUP_OTP_MAX_ATTEMPTS) {
          patched.otpLockedUntil = now + PICKUP_OTP_LOCK_MINUTES * 60 * 1000;
        }

        return patched; // ✅ commit để lưu attempts
      }

      // Đúng OTP -> mở đơn (reset attempts)
      return {
        ...cur,
        status: "opened",
        openedAt: now,
        otpAttempts: 0,
        otpLockedUntil: 0,
        // expiresAt: now, // optional nếu bạn muốn “đóng đơn ngay”
      };
    });

    // Không commit -> trả đúng lỗi chi tiết như cũ (và thêm case lock)
    if (!tx.committed) {
      const latestSnap = await reservationRef.once("value");
      const reservation = latestSnap.val();

      if (!reservation) {
        return res.status(400).json({ error: "Không tìm thấy đơn đặt tủ" });
      }

      if (reservation.receiverPhone !== phoneNumber) {
        return res.status(403).json({ error: "Bạn không có quyền mở đơn đặt tủ này" });
      }

      if (reservation.status !== "loaded") {
        return res
          .status(400)
          .json({ error: `Đơn ở trạng thái '${reservation.status}', không thể mở bằng OTP` });
      }

      if (Date.now() > (reservation.expiresAt || 0)) {
        return res.status(400).json({ error: "Đơn đặt tủ đã hết hạn" });
      }

      if (reservation.otpLockedUntil && Date.now() < reservation.otpLockedUntil) {
        return res.status(429).json({ error: "Bạn nhập sai quá 5 lần, vui lòng thử lại sau 5 phút" });
      }

      const storedOtp = reservation.pickupOtp || reservation.otpCode;
      if (!storedOtp || storedOtp !== otpCode) {
        return res.status(400).json({ error: "Mã OTP không đúng" });
      }

      return res.status(400).json({ error: "Không thể xử lý yêu cầu mở tủ" });
    }

    // Commit rồi: có thể là "opened" hoặc chỉ là commit attempts do sai OTP
    const updatedReservation = tx.snapshot.val();

    // Nếu bị khoá hoặc OTP sai (commit attempts) -> trả message tương ứng
    if (updatedReservation.status !== "opened") {
      if (updatedReservation.otpLockedUntil && Date.now() < updatedReservation.otpLockedUntil) {
        return res.status(429).json({ error: "Bạn nhập sai quá 5 lần, vui lòng thử lại sau 5 phút" });
      }
      return res.status(400).json({ error: "Mã OTP không đúng" });
    }

    // ✅ opened -> mở tủ + nhả tủ về idle
    await lockerRefById(updatedReservation.lockerId).update({
      command: "open",
      status: "idle",
      last_update: Date.now(),
    });

    // Ghi log
    const logRef = db.ref("/Logs").push();
    await logRef.set({
      phone: phoneNumber,
      locker: updatedReservation.lockerId,
      action: "open_by_receiver",
      timestamp: Date.now(),
      result: "success",
      reservationId: reservationId
    });

    return res.json({
      success: true,
      lockerOpened: true,
      message: "Mở tủ thành công, bạn có thể lấy hàng."
    });
  } catch (error) {
    console.error("Error verifying OTP & opening locker:", error);
    return res.status(500).json({ error: "Lỗi khi xác thực OTP và mở tủ" });
  }
});



// =======================
// 9. Serve static HTML files
// =======================

// Serve toàn bộ file tĩnh trong thư mục cha (index.html, dashboard.html, shipper.html,...)
app.use(express.static(path.join(__dirname, "../frontend")));

// Trang chính (login/index)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// Dashboard cư dân
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/dashboard.html"));
});

// Trang shipper
app.get("/shipper", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/shipper.html"));
});

// (nếu có trang receiver.html thì giữ, không có thì bỏ)
app.get("/receiver", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/receiver.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/admin.html"));
});



// =======================
// 10. Start Server
// =======================
app.listen(PORT, () => {
  console.log(`🚀 Smart Locker Backend running at http://localhost:${PORT}`);
  console.log(`📱 Main page: http://localhost:${PORT}`);
  console.log(`🔍 Shipper page: http://localhost:${PORT}/shipper`);

});
