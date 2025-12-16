//1 Smart Locker Backend Server
require("dotenv").config();
// giau secretkey vao .env
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const cookieParser = require("cookie-parser");
// cookie-parser: xử lý cookie trong request
// Danh sách tủ logic theo kích thước (demo)
// Thực tế: mỗi lockerId có thể là 1 ngăn tủ thật.
const LOCKERS_BY_SIZE = {
  small: ["S1", "S2"],      // tủ nhỏ
  medium: ["M1", "M2"],     // tủ vừa
  large: ["L1","L2"]             // tủ lớn
};
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

//2 ket noi firebase
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
// 3. Khởi tạo express
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
//Nếu không có (vd: quên set, hoặc đang dev lười tạo .env), thì dùng tạm "bimatnho" cho khỏi crash.
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
// 4. Middleware xác thực jwt
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

// 5.Admin: xem tất cả đơn đặt tủ
app.get("/api/admin/reservations-all", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const snap = await db.ref("/Reservations").once("value");
    const data = snap.val() || {};
//Đoạn này là JS/TS để biến đổi data (object) thành một mảng reservations rồi sắp xếp theo thời gian tạo mới nhất trước.
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

// 6.Admin: xem log hệ thống
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
// 7. Admin gửi lệnh mở/đóng locker
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



// 8.Gửi OTP
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
    //console.log(...) bạn viết trong backend/server (Node/Express/Firebase Functions, v.v.) thì khi deploy, log đó chỉ xuất hiện ở log của server (terminal lúc chạy local, hoặc Cloud Logs / Railway / Render / Vercel logs…).
 //User bấm F12 chỉ thấy console.log chạy trong trình duyệt (frontend). Trình duyệt không thấy log từ server.
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

//9. Đăng nhập bằng OTP (verify + tạo token)
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
     // 4. Lấy thông tin user từ /Users
    const phoneNumber = otpData.phoneNumber;
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
  httpOnly: true,  //Cookie không đọc được bằng JS ở trình duyệt (không document.cookie được).Giúp giảm rủi ro bị ăn cắp cookie nếu XSS.
  sameSite: "lax",//Hạn chế cookie bị gửi trong các request “cross-site” (giảm CSRF).
  secure: isProduction,//true thì cookie chỉ gửi qua HTTPS.
  maxAge: 7 * 24 * 60 * 60 * 1000,// 7ngay
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

// 10.Đăng ký user mới
app.post("/api/auth/register", async (req, res) => {
  const { phoneNumber, fullName, verificationId, otpCode, apartment } = req.body;

  if (!phoneNumber || !fullName || !verificationId || !otpCode) {
    return res
      .status(400)
      .json({ error: "All fields required (phone, name, otp...)" });
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

// 11.Cư dân đặt tủ trước (có chọn kích thước tủ)
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



// 12.Lấy lịch sử đặt tủ của cư dân (theo số đang đăng nhập)
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

// =======================
// 13.Receiver: kiểm tra đơn hàng đang chờ (status = loaded)
// =======================
app.post("/api/receiver/check-reservation", authenticateToken, async (req, res) => {
  const phoneNumber = req.user && req.user.phoneNumber;

  if (!phoneNumber) {
    return res.status(401).json({ success: false, error: "Không xác định được người dùng" });
  }

  try {
    const snap = await db
      .ref("/Reservations")
      .orderByChild("receiverPhone")
      .equalTo(phoneNumber)
      .once("value");

    const data = snap.val() || {};
    const now = Date.now();

    const entries = Object.entries(data).map(([id, r]) => ({ id, r }));

    // Chỉ quan tâm các đơn đã được shipper bỏ hàng (loaded) và chưa hết hạn
    const loadedReservations = entries
      .filter(({ r }) => {
        if (!r) return false;
        const expiresAt = Number(r.expiresAt || 0);
        return r.status === "loaded" && now <= expiresAt;
      })
      .sort((a, b) => {
        const ta = b.r.loadedAt || b.r.createdAt || 0;
        const tb = a.r.loadedAt || a.r.createdAt || 0;
        return ta - tb; // sort desc theo (loadedAt || createdAt)
      });

    if (!loadedReservations.length) {
      return res.json({
        success: true,
        hasReservation: false,
      });
    }

    const chosen = loadedReservations[0];
    const r = chosen.r;

    return res.json({
      success: true,
      hasReservation: true,
      reservation: {
        id: chosen.id,
        lockerId: r.lockerId || "Locker1",
        status: r.status || "loaded",
        expiresAt: r.expiresAt || null,
        createdAt: r.createdAt || null,
        loadedAt: r.loadedAt || null,
      },
    });
  } catch (err) {
    console.error("Error checking receiver reservation:", err);
    return res
      .status(500)
      .json({ success: false, error: "Lỗi kiểm tra đơn hàng đang chờ" });
  }
});

// =======================
// 14.Receiver: nhập OTP để mở tủ
// =======================
app.post("/api/receiver/verify-and-open", authenticateToken, async (req, res) => {
  const reservationId = String(req.body.reservationId || "").trim();
  const otpCode = String(req.body.otpCode || "").trim(); // ép về string
  const phoneNumber = String(req.user.phoneNumber || "").trim();

  if (!reservationId || !otpCode) {
    return res.status(400).json({ error: "Reservation ID và OTP là bắt buộc" });
  }

  const reservationRef = db.ref("/Reservations").child(reservationId);

  function normalizeOtp(x) {
    return String(x ?? "").trim();
  }

  function normalizePhoneVN(p) {
    p = String(p ?? "").replace(/\s+/g, "");
    if (p.startsWith("+84")) return "0" + p.slice(3);
    if (p.startsWith("84")) return "0" + p.slice(2);
    return p;
  }

  async function openLockerAndLog(lockerId, action) {
    const ts = Date.now();
    await lockerRefById(lockerId).update({
      command: "open",
      status: "idle",
      last_update: ts,
    });

    const logRef = db.ref("/Logs").push();
    await logRef.set({
      phone: phoneNumber,
      locker: lockerId,
      action,
      timestamp: ts,
      result: "success",
      reservationId,
    });
  }

  async function attemptTransactionOpen() {
    return reservationRef.transaction((cur) => {
      if (!cur) return;

      const now = Date.now();

      // Chuẩn hoá SĐT để tránh +84/84/0...
      const curPhone = normalizePhoneVN(cur.receiverPhone);
      const reqPhone = normalizePhoneVN(phoneNumber);
      if (curPhone !== reqPhone) return;

      // Idempotent: đã opened rồi thì giữ nguyên (coi như thành công)
      if (cur.status === "opened") {
        return cur;
      }

      if (cur.status !== "loaded") return;
      if (now > Number(cur.expiresAt || 0)) return;

      if (cur.otpLockedUntil && now < Number(cur.otpLockedUntil || 0)) return;

      const storedOtp = normalizeOtp(cur.pickupOtp || cur.otpCode);
      const inputOtp = normalizeOtp(otpCode);

      // Sai OTP -> tăng attempts và có thể khoá
      if (!storedOtp || storedOtp !== inputOtp) {
        const nextAttempts = Number(cur.otpAttempts || 0) + 1;
        const patched = { ...cur, otpAttempts: nextAttempts };

        if (nextAttempts >= PICKUP_OTP_MAX_ATTEMPTS) {
          patched.otpLockedUntil = now + PICKUP_OTP_LOCK_MINUTES * 60 * 1000;
        }
        return patched;
      }

      // Đúng OTP -> opened
      return {
        ...cur,
        status: "opened",
        openedAt: now,
        otpAttempts: 0,
        otpLockedUntil: 0,
      };
    });
  }

  try {
    // Lần 1
    let tx = await attemptTransactionOpen();

    // Nếu không commit, đọc latest + thử lại lần 2 (hay cứu được do retry/network)
    if (!tx.committed) {
      const latest = (await reservationRef.once("value")).val();
      if (!latest) return res.status(400).json({ error: "Không tìm thấy đơn đặt tủ" });

      const now = Date.now();

      const curPhone = normalizePhoneVN(latest.receiverPhone);
      const reqPhone = normalizePhoneVN(phoneNumber);
      if (curPhone !== reqPhone) return res.status(403).json({ error: "Bạn không có quyền mở đơn đặt tủ này" });

      // Nếu đã opened sẵn → coi như thành công
      if (latest.status === "opened") {
        if (latest.lockerId) {
          await openLockerAndLog(latest.lockerId, "open_by_receiver_already_opened");
        }
        return res.json({ success: true, lockerOpened: true, message: "Đơn đã mở trước đó." });
      }

      // Nếu không đúng điều kiện thì trả lỗi rõ ràng
      if (latest.status !== "loaded") {
        return res.status(400).json({ error: `Đơn ở trạng thái '${latest.status}', không thể mở bằng OTP` });
      }
      if (now > Number(latest.expiresAt || 0)) {
        return res.status(400).json({ error: "Đơn đặt tủ đã hết hạn" });
      }
      if (latest.otpLockedUntil && now < Number(latest.otpLockedUntil || 0)) {
        return res.status(429).json({ error: "Bạn nhập sai quá 5 lần, vui lòng thử lại sau 5 phút" });
      }

      const storedOtp = normalizeOtp(latest.pickupOtp || latest.otpCode);
      const inputOtp = normalizeOtp(otpCode);
      if (!storedOtp || storedOtp !== inputOtp) {
        return res.status(400).json({ error: "Mã OTP không đúng" });
      }

      // Thử transaction lần 2
      tx = await attemptTransactionOpen();

      // Nếu vẫn không commit nhưng mọi điều kiện vẫn đúng → fallback update
      if (!tx.committed) {
        const nowFallback = Date.now();

        // Fallback update trực tiếp (chỉ làm khi chắc chắn status vẫn loaded)
        const latest2 = (await reservationRef.once("value")).val();
        if (!latest2) return res.status(400).json({ error: "Không tìm thấy đơn đặt tủ" });

        if (latest2.status !== "loaded") {
          return res.status(400).json({ error: `Trạng thái hiện tại: ${latest2.status}, không thể dùng OTP.` });
        }

        await reservationRef.update({
          status: "opened",
          openedAt: nowFallback,
          otpAttempts: 0,
          otpLockedUntil: 0,
        });

        if (latest2.lockerId) {
          await openLockerAndLog(latest2.lockerId, "open_by_receiver_fallback");
        }

        return res.json({
          success: true,
          lockerOpened: true,
          message: "Mở tủ thành công (fallback).",
        });
      }
    }

    // Commit rồi: có thể opened hoặc chỉ commit attempts do sai OTP
    const updated = tx.snapshot.val();

    if (updated.status !== "opened") {
      if (updated.otpLockedUntil && Date.now() < Number(updated.otpLockedUntil || 0)) {
        return res.status(429).json({ error: "Bạn nhập sai quá 5 lần, vui lòng thử lại sau 5 phút" });
      }
      return res.status(400).json({ error: "Mã OTP không đúng" });
    }

    if (updated.lockerId) {
      await openLockerAndLog(updated.lockerId, "open_by_receiver");
    }

    return res.json({
      success: true,
      lockerOpened: true,
      message: "Mở tủ thành công, bạn có thể lấy hàng.",
    });
  } catch (error) {
    console.error("[receiver/verify-and-open] Error:", error);
    return res.status(500).json({ error: "Lỗi khi xác thực OTP và mở tủ" });
  }
});


//15 Shipper dùng mã đặt tủ (bookingCode) để mở tủ và đánh dấu đã bỏ hàng
app.post("/api/shipper/use-reservation", async (req, res) => {
  const raw = req.body && req.body.bookingCode;
  const codeStr = String(raw ?? "").trim();
  const codeNum = Number(codeStr);

  console.log("[shipper/use-reservation] Incoming bookingCode:", {
    raw,
    codeStr,
    codeNum: Number.isNaN(codeNum) ? null : codeNum,
  });

  if (!codeStr) {
    return res.status(400).json({ error: "Booking code required" });
  }

  try {
    const reservationsRef = db.ref("/Reservations");

    // 1) Thử tìm theo string trước
    let snap = await reservationsRef
      .orderByChild("bookingCode")
      .equalTo(codeStr)
      .once("value");

    // 2) Nếu không thấy và codeNum hợp lệ -> thử theo number
    if (!snap.exists() && !Number.isNaN(codeNum)) {
      console.log(
        "[shipper/use-reservation] No reservation with string code, try numeric",
        { codeStr, codeNum }
      );
      snap = await reservationsRef
        .orderByChild("bookingCode")
        .equalTo(codeNum)
        .once("value");
    }

    const all = snap.val();
    if (!all) {
      console.log(
        "[shipper/use-reservation] No reservation found after both queries",
        { codeStr, codeNum: Number.isNaN(codeNum) ? null : codeNum }
      );
      return res
        .status(400)
        .json({ error: "Không tìm thấy mã đặt tủ này" });
    }

    const now = Date.now();
    const entries = Object.entries(all).map(([id, r]) => ({ id, r }));

    // 3) Lọc reservation hợp lệ: status = booked, chưa hết hạn
    const candidates = entries
      .filter(({ r }) => {
        if (!r) return false;
        const expiresAt = Number(r.expiresAt || 0);
        return r.status === "booked" && now <= expiresAt;
      })
      .sort((a, b) => (b.r.createdAt || 0) - (a.r.createdAt || 0));

    if (!candidates.length) {
      // Có bản ghi nhưng không cái nào còn hợp lệ:
      // ưu tiên báo hết hạn nếu tất cả đã hết hạn
      const any = entries[0]?.r;
      const hasExpired = entries.some(({ r }) => now > (r?.expiresAt || 0));
      if (hasExpired) {
        console.log(
          "[shipper/use-reservation] Booking code exists but expired",
          { codeStr }
        );
        return res
          .status(400)
          .json({ error: "Đơn đặt tủ đã hết hạn" });
      }

      const currentStatus = any?.status || "unknown";
      console.log(
        "[shipper/use-reservation] Booking code exists but invalid status",
        { codeStr, status: currentStatus }
      );
      return res.status(400).json({
        error: `Mã tồn tại nhưng không hợp lệ (trạng thái: ${currentStatus}).`,
      });
    }

    const chosen = candidates[0];
    const reservationId = chosen.id;

    console.log("[shipper/use-reservation] Chosen reservation", {
      reservationId,
      createdAt: chosen.r.createdAt,
      lockerId: chosen.r.lockerId,
    });

    // 4) Đọc trước để chắc chắn reservation tồn tại ở path này
    const reservationRef = db.ref(`/Reservations/${reservationId}`);
    const preSnap = await reservationRef.once("value");
    const preData = preSnap.val();

    if (!preData) {
      console.warn(
        "[shipper/use-reservation] Reservation disappeared before transaction",
        { reservationId }
      );
      return res
        .status(400)
        .json({ error: "Không tìm thấy mã đặt tủ này" });
    }

    // 5) Transaction: cập nhật duy nhất 1 lần từ booked -> loaded
    let abortReason = null;
    const pickupOtp = Math.floor(100000 + Math.random() * 900000).toString();

    const doTx = async () => {
      abortReason = null;
      return reservationRef.transaction((current) => {
        if (!current) {
          abortReason = "missing";
          return; // abort
        }

        const nowTx = Date.now();
        if (nowTx > (current.expiresAt || 0)) { abortReason = "expired"; return; }
        if (current.status !== "booked") { abortReason = "invalid_status"; return; }

        return {
          ...current,
          status: "loaded",
          loadedAt: nowTx,
          pickupOtp,
          otpCode: pickupOtp,
        };
      }, undefined, false);
    };

    let tx = await doTx();

    // Biến latest luôn ở scope ngoài
    let latest = null;

    if (!tx.committed) {
      console.warn("[shipper/use-reservation] Transaction NOT committed", { reservationId, abortReason });

      // ✅ missing: đọc lại 1 lần + retry transaction 1 lần
      if (abortReason === "missing") {
        const checkSnap = await reservationRef.once("value");
        const checkVal = checkSnap.val();

        console.warn("[shipper/use-reservation] Tx missing, recheck node", {
          reservationId,
          exists: !!checkVal,
        });

        // Nếu node có lại (race), thử transaction lại 1 lần
        if (checkVal) {
          tx = await doTx();
        } else {
          // Node thật sự không tồn tại
          return res.status(400).json({ error: "Không tìm thấy mã đặt tủ này" });
        }
      }

      // Nếu retry xong vẫn not committed thì xử lý theo reason
      if (!tx.committed) {
        if (abortReason === "expired") {
          return res.status(400).json({ error: "Đơn đặt tủ đã hết hạn" });
        }

        if (abortReason === "invalid_status") {
          const snapTx = tx.snapshot && tx.snapshot.val();
          const latestStatus = snapTx?.status || "unknown";
          return res.status(400).json({
            error: `Trạng thái hiện tại: ${latestStatus}, không thể dùng mã này.`,
          });
        }

        // Fallback: đọc trạng thái hiện tại
        const latestSnap = await reservationRef.once("value");
        latest = latestSnap.val();

        if (!latest) {
          return res.status(400).json({ error: "Không tìm thấy mã đặt tủ này" });
        }
        if (Date.now() > (latest.expiresAt || 0)) {
          return res.status(400).json({ error: "Đơn đặt tủ đã hết hạn" });
        }

        // Nếu vẫn booked -> update trực tiếp 1 lần
        if (latest.status === "booked") {
          console.warn("[shipper/use-reservation] Fallback direct update", { reservationId });
          const nowFallback = Date.now();
          await reservationRef.update({
            status: "loaded",
            loadedAt: nowFallback,
            pickupOtp,
            otpCode: pickupOtp,
          });
          latest = (await reservationRef.once("value")).val();
        } else {
          return res.status(400).json({
            error: `Trạng thái hiện tại: ${latest.status || "unknown"}, không thể dùng mã này.`,
          });
        }
      }
    }
    console.log("[shipper/use-reservation] reservationRef path", reservationRef.toString());
    console.log("[shipper/use-reservation] preData exists", !!preData, { reservationId });

    // ✅ updatedReservation chuẩn, không còn usedFallback/ latest ngoài scope
    const updatedReservation = tx.committed
      ? (tx.snapshot.val() || {})
      : (latest || {});

    // 5) Sau khi commit thành công -> cập nhật locker
    let usedFallback = false;
    let nowFallback = null;

    if (!tx.committed) {
      if (latest.status === "booked") {
        usedFallback = true;
        nowFallback = Date.now();
        await reservationRef.update({
          status: "loaded",
          loadedAt: nowFallback,
          pickupOtp,
          otpCode: pickupOtp,
        });
      }
    }

    const lockerId = updatedReservation.lockerId || chosen.r.lockerId || null;

    if (!lockerId) {
      console.warn(
        "[shipper/use-reservation] Missing lockerId for reservation",
        { reservationId }
      );

      // Không crash, vẫn trả success vì reservation đã được cập nhật
      return res.json({
        success: true,
        lockerId: null,
        message:
          "Đã ghi nhận đơn hàng (loaded) nhưng không tìm thấy locker tương ứng. Vui lòng liên hệ quản trị.",
      });
    }

    try {
      await lockerRefById(lockerId).update({
        command: "open",
        status: "loaded",
        last_update: Date.now(),
      });
    } catch (lockerErr) {
      console.error(
        "[shipper/use-reservation] Failed to update locker",
        { lockerId, reservationId, error: lockerErr }
      );
      // Không throw để tránh crash; reservation đã ở trạng thái loaded
    }

    if (pickupOtp) {
      console.log(
        `🎯 OTP cho người nhận (${updatedReservation.receiverPhone}): ${pickupOtp}`
      );
    }

    return res.json({
      success: true,
      lockerId,
      message: "Đã mở tủ cho shipper và tạo OTP cho người nhận.",
    });
  } catch (err) {
    console.error("Error using reservation by shipper:", err);
    return res
      .status(500)
      .json({ error: "Lỗi xử lý mã đặt tủ cho shipper" });
  }
});




// =======================
// 16. Serve static HTML files
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
// 17. Start Server
// =======================
app.listen(PORT, () => {
  console.log(`🚀 Smart Locker Backend running at http://localhost:${PORT}`);
  console.log(`📱 Main page: http://localhost:${PORT}`);
  console.log(`🔍 Shipper page: http://localhost:${PORT}/shipper`);

});
// admin 3 api,user 4 ,ship 1