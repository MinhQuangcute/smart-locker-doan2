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
const cron = require("node-cron");

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
//hasitem các kiểu
function parseHasItem(v) {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;

  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;

  // nếu thiếu / không rõ -> null (không có sensor hoặc chưa gửi)
  return null;
}
//hàm quét đơn quá hạn 
async function flagOverdueReservations() {
  const now = Date.now();

  // Lấy các đơn có expiresAt <= now (nên indexOn expiresAt để nhanh)
  const snap = await db
    .ref("/Reservations")
    .orderByChild("expiresAt")
    .endAt(now)
    .once("value");

  const obj = snap.val() || {};
  const updates = {};
  let count = 0;

  for (const [id, r] of Object.entries(obj)) {
    if (!r) continue;

    const exp = Number(r.expiresAt || 0);
    if (!exp) continue;

    const st = String(r.status || "").trim().toLowerCase();

    // CHỈ những trạng thái phù hợp với route /overdue/open của bạn
    if (!["loaded", "opened"].includes(st)) continue;

    // đã gắn cờ rồi thì bỏ qua
    if (r.needAdminPickup === true) continue;

    updates[`/Reservations/${id}/needAdminPickup`] = true;
    updates[`/Reservations/${id}/needAdminPickupAt`] = now;
    count++;
  }

  if (count > 0) {
    await db.ref().update(updates);
  }

  return { flagged: count };
}

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
//hàm quét
cron.schedule("* * * * *", async () => { // mỗi 1 phút
  try {
    const { flagged } = await flagOverdueReservations();
    if (flagged) console.log(`[cron] flagged overdue: ${flagged}`);
  } catch (e) {
    console.error("[cron] flagOverdueReservations error:", e);
  }
});
//hàm claim để user đặt tủ
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
//hàm nhả tủ khi user đặt
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

//hamcheck esp offfline
async function ensureOfflineIncident(lockerId) {
  // tạo incident OFFLINE nếu chưa có incident open cho locker này
  const snap = await db.ref("/Incidents")
    .orderByChild("lockerId")
    .equalTo(lockerId)
    .once("value");
  const obj = snap.val() || {};
  const hasOpen = Object.values(obj).some(x => x?.type==="OFFLINE" && x?.status==="open");
  if (!hasOpen) {
    await db.ref("/Incidents").push().set({
      type: "OFFLINE",
      lockerId,
      reservationId: "",
      status: "open",
      createdAt: Date.now(),
      resolvedAt: 0,
      note: "Locker mất mạng/không heartbeat"
    });
  }
}

async function offlineWatchdogJob() {
  const now = Date.now();
  const snap = await db.ref("/Lockers").once("value");
  const lockers = snap.val() || {};

  const updates = {}
  for (const [lid, l] of Object.entries(lockers)) {
    const lastSeen = Number(l?.lastSeenAt || 0);
    const isOffline = !lastSeen || (now - lastSeen > 60 * 1000);

    if (isOffline && l?.netState !== "offline") {
      updates[`/Lockers/${lid}/netState`] = "offline";
      await ensureOfflineIncident(lid);
    }

    if (!isOffline && l?.netState === "offline") {
      // resolve OFFLINE incident (tuỳ bạn)
      updates[`/Lockers/${lid}/netState`] = "online";
      // có thể đóng incident OFFLINE open ở đây
    }
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  console.log("[offlineWatchdog] tick", new Date().toISOString());

}

// mỗi 30s
setInterval(() => offlineWatchdogJob().catch(console.error), 30000);


//fakescript cho esp
const ALL_LOCKERS = Object.values(LOCKERS_BY_SIZE).flat();

setInterval(async () => {
  const now = Date.now();
  const updates = {};

  for (const lid of ALL_LOCKERS) {
    updates[`/Lockers/${lid}/lastSeenAt`] = now;
    updates[`/Lockers/${lid}/netState`] = "online";
  }

  await db.ref().update(updates);
  console.log("heartbeat", new Date(now).toISOString());
}, 10000);

function makeCommandId() {
  return "cmd_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}
/*
async function sendLockerCommand(lockerId, action, reservationId) {
  const cmdId = makeCommandId();
  const now = Date.now();

  await lockerRefById(lockerId).update({
    command: { id: cmdId, action, issuedAt: now, reservationId: reservationId || "" }
  });

  return { cmdId, issuedAt: now };
}
*/

async function waitAck(lockerId, cmdId, timeoutMs =30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const l = (await lockerRefById(lockerId).once("value")).val() || {};
    const ack = l.lastAck || null;

    if (ack && ack.commandId === cmdId) return ack;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}


//helper checklocker
function isLockerOffline(locker, now = Date.now()) {
  const lastSeen = Number(locker?.lastSeenAt || 0);
  const netState = String(locker?.netState || "").toLowerCase();

  // nếu đã có watchdog set netState=offline thì chặn luôn
  if (netState === "offline") return true;

  // nếu không có lastSeenAt hoặc lastSeenAt quá cũ -> coi là offline
  if (!lastSeen) return true;

  // ngưỡng offline: 60s (phải khớp với watchdog)
  if (now - lastSeen > 60 * 1000) return true;

  return false;
}

async function assertLockerOnline(lockerId) {
  const ref = lockerRefById(lockerId);
  const locker = (await ref.once("value")).val() || {};
  const now = Date.now();

  if (isLockerOffline(locker, now)) {
    const lastSeen = Number(locker?.lastSeenAt || 0);
    const ageSec = lastSeen ? Math.floor((now - lastSeen) / 1000) : null;

    const msg = lastSeen
      ? `Locker OFFLINE (lastSeen ${ageSec}s trước). Không gửi lệnh.`
      : "Locker OFFLINE (chưa từng heartbeat). Không gửi lệnh.";

    const err = new Error(msg);
    err.statusCode = 409;
    err.meta = { lockerId, lastSeenAt: lastSeen, netState: locker?.netState || "" };
    throw err;
  }

  return { ref, locker };
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
//const RESERVATION_EXPIRY_HOURS = 24 * 3;
const PICKUP_OTP_MAX_ATTEMPTS = 5;     // tối đa 5 lần sai
const PICKUP_OTP_LOCK_MINUTES = 5;    // khoá 5 phút
const OTP_SEND_COOLDOWN_SECONDS = 30;
const OTP_LOCK_MINUTES = 3;//otp dangnhap/dangki
const OTP_MAX_ATTEMPTS = 5;

// =======================
// 4. Middleware xác thực jwt
// =======================
//Đúng ý rồi, chỉ chỉnh câu chữ cho chuẩn hơn một chút:
//Bạn ký 1 lần khi tạo token: jwt.sign(payload, JWT_SECRET)tạo ra chữ ký signature.

//Khi nhận request, server không “ký lại token” theo kiểu tạo token mới, mà nó:lấy header + payload trong token,dùng cùng JWT_SECRET để tính lại chữ ký dự kiến,

//so sánh chữ ký dự kiến với signature đang có trong token.

//khớp ⇒ token không bị sửa + đúng secret ⇒ hợp lệ ⇒ trả payload cho bạn (gắn vào req.user).
//Không khớp ⇒ token bị sửa/giả/mất hạn ⇒ reject.
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

  jwt.verify(token, JWT_SECRET, (err, user) => { //layheader,payload ,kí lại
    if (err) {
      console.error("JWT verify error:", err);
      return res.status(403).json({ error: "Invalid token" });
    }
    req.user = user;//phonenumber và role- payload
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

// 1.Admin: xem tất cả đơn đặt tủ
app.get("/api/admin/reservations-all", authenticateToken, requireAdmin, async (req, res) => {
  try {
    await flagOverdueReservations();

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

// 2.Admin: xem log hệ thống
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



// 3.Gửi OTP
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

//4. Đăng nhập bằng OTP (verify + tạo token)
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
    const token = jwt.sign(  //cjwt.sign(...) trả về một JWT token hoàn chỉnh, trong đó có chữ ký nằm bên trong.header: thuật toán ký (HS256…), loại token…payload: cái bạn đưa vào { phoneNumber, role, iat, exp... }signature: chữ ký được tạo từ header + payload và JWT_SECRET
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

// 5.Đăng ký user mới
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

// 6.Cư dân đặt tủ trước (có chọn kích thước tủ)
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
 //const expiresAt = now + (RESERVATION_EXPIRY_HOURS * 60 * 60 * 1000);
 const expiresAt = now + 120 * 1000; // 10 giây


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

      // ✅ Chuẩn hoá lockerId + tạo bookingKey
      lockerId = String(lockerId).trim().toUpperCase();
      const bookingKey = `${lockerId}_${bookingCode}`; // ví dụ: L2_327977
    // ✅ Ghi reservation sau khi claim thành công
    await db.ref(`/Reservations/${reservationId}`).set({
      receiverPhone,
      lockerId,
      lockerSize: size,
      bookingCode,
      bookingKey,         // ✅ thêm field này
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
      bookingKey,   
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



// 7.Lấy lịch sử đặt tủ của cư dân (theo số đang đăng nhập)
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
// 8.Receiver: kiểm tra đơn hàng đang chờ (status = loaded)
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

//9.nguoidung mở tủ ,có transac,xuly matmang,ack
app.post("/api/receiver/verify-and-open", authenticateToken, async (req, res) => {
  const { reservationId, otpCode } = req.body;
  const phoneNumber = req.user?.phoneNumber;

  if (!reservationId || !otpCode) {
    return res.status(400).json({ error: "Thiếu thông tin xác thực" });
  }

  try {
    // 1. Lấy dữ liệu Reservation & Kiểm tra tồn tại
    const reservationRef = db.ref("/Reservations").child(reservationId);
    const cur = (await reservationRef.once("value")).val();

    if (!cur) return res.status(404).json({ error: "Không tìm thấy đơn đặt tủ" });

    // 2. Kiểm tra quyền sở hữu (Số điện thoại)
    if (normalizePhone(cur.receiverPhone) !== normalizePhone(phoneNumber)) {
      return res.status(403).json({ error: "Bạn không có quyền mở đơn này" });
    }

    // 3. Kiểm tra trạng thái và Hết hạn
    const now = Date.now();
    if (cur.status !== "loaded" && cur.status !== "opened") {
      return res.status(400).json({ error: `Trạng thái ${cur.status} không hợp lệ` });
    }
    if (cur.status === "loaded" && now > Number(cur.expiresAt)) {
      return res.status(400).json({ error: "Đơn đặt tủ đã quá hạn" });
    }

    // 4. Kiểm tra brute-force OTP (Bị khóa tạm thời)
    if (cur.otpLockedUntil && now < cur.otpLockedUntil) {
      return res.status(429).json({ error: "Thử lại quá nhiều lần, vui lòng đợi." });
    }

    // 5. Xác thực OTP
    const storedOtp = String(cur.pickupOtp || cur.otpCode || "").trim();
    if (storedOtp !== String(otpCode).trim()) {
      const nextAttempts = (cur.otpAttempts || 0) + 1;
      const patch = { otpAttempts: nextAttempts };
      if (nextAttempts >= PICKUP_OTP_MAX_ATTEMPTS) {
        patch.otpLockedUntil = now + PICKUP_OTP_LOCK_MINUTES * 60 * 1000;
      }
      await reservationRef.update(patch);
      return res.status(400).json({ error: "Mã OTP không chính xác" });
    }

    // --- BẮT ĐẦU XỬ LÝ LỆNH MỞ TỦ (STATUS MACHINE) ---

    const lockerId = cur.lockerId;
    // Kiểm tra ESP32 còn sống không trước khi gửi lệnh
    await assertLockerOnline(lockerId); 

    const cmdId = makeCommandId(); // Tạo ID lệnh duy nhất
    const action = "open";

    // Ghi lệnh xuống Firebase với trạng thái PENDING
    const lockerRef = lockerRefById(lockerId);
   /* await lockerRef.update({
      command: {
        id: cmdId,
        action: action,
        status: "PENDING",
        issuedAt: now,
        reservationId: reservationId
      }
    });*/

    // Thay vì dùng .update, hãy dùng transaction cho lệnh
const result = await lockerRef.child("command").transaction((current) => {
  if (current && current.status === "PENDING") {
    return; // Trả về undefined để hủy transaction vì đang có lệnh chờ xử lý
  }
  return {
    id: cmdId,
    action: "open",
    status: "PENDING",
    issuedAt: Date.now(),
    reservationId: reservationId
  };
});

if (!result.committed) {
  return res.status(409).json({ error: "Hệ thống đang thực hiện lệnh trước đó, vui lòng đợi." });
}

    // 6. Đợi ESP32 phản hồi (waitAck) - Giải quyết vấn đề mất mạng
    // Hàm này sẽ poll Firebase mỗi 500ms để tìm lastAck khớp với cmdId
    const ack = await waitAck(lockerId, cmdId); // Chờ tối đa 12 giây

    if (!ack) {
      return res.status(504).json({ 
        error: "Tủ không phản hồi. Có thể do mất kết nối mạng, vui lòng thử lại sau." 
      });
    }

    if (ack.status === "FAILED") {
      return res.status(500).json({ error: "Tủ báo lỗi vật lý (Kẹt khóa...)" });
    }

    // 7. Cập nhật kết quả cuối cùng sau khi ESP32 đã Ack thành công
    const updates = {};
    updates[`/Reservations/${reservationId}/status`] = "opened"; // Kết thúc chu kỳ đơn hàng
    updates[`/Reservations/${reservationId}/openedAt`] = now;
    updates[`/Reservations/${reservationId}/otpAttempts`] = 0;
    updates[`/Lockers/${lockerId}/status`] = "idle"; // Nhả tủ về trạng thái trống
    updates[`/Lockers/${lockerId}/reservationId`] = null;
    updates[`/Lockers/${lockerId}/command`] = null; // Xóa lệnh cũ

    await db.ref().update(updates);

    // 8. Log hành động
    await db.ref("/Logs").push().set({
      phone: phoneNumber,
      locker: lockerId,
      action: "open_by_reciever",
      timestamp: now,
      result: "success",
      reservationId
    });

    return res.json({
      success: true,
      message: "Mở tủ thành công, mời bạn lấy đồ.",
      lockerId,
  reservationId
    });

  } catch (error) {
    console.error("[verify-and-open] Error:", error);
    return res.status(error.statusCode || 500).json({ 
      error: error.message || "Lỗi xử lý yêu cầu" 
    });
  }
});


//10.ship mở tủ
app.post("/api/shipper/use-reservation", async (req, res) => {
  const codeStr = String(req.body?.bookingCode ?? "").trim();
  const lockerId = String(req.body?.lockerId ?? "").trim().toUpperCase();

  if (!codeStr || !lockerId) {
    return res.status(400).json({ error: "Thiếu Booking Code hoặc Locker ID" });
  }

  const bookingKey = `${lockerId}_${codeStr}`;

  try {
    // 1. Tìm đơn đặt tủ dựa trên bookingKey
    const snap = await db.ref("/Reservations")
      .orderByChild("bookingKey")
      .equalTo(bookingKey)
      .once("value");

    const all = snap.val();
    if (!all) return res.status(400).json({ error: "Mã đặt tủ hoặc mã tủ không đúng." });

    // Lấy đơn mới nhất nếu có trùng key (đã sort)
    const [reservationId, pre] = Object.entries(all)
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))[0];

    // 2. Kiểm tra tính hợp lệ của đơn
    if (Date.now() > Number(pre.expiresAt || 0)) {
      return res.status(400).json({ error: "Đơn đặt tủ đã hết hạn" });
    }
    if (pre.status !== "booked") {
      return res.status(400).json({ error: `Đơn đang ở trạng thái ${pre.status}, không thể mở.` });
    }

    // 3. Kiểm tra trạng thái vật lý của tủ (Sensor) và Online
    const lockerRef = lockerRefById(lockerId);
    const lockerSnap = await lockerRef.once("value");
    const locker = lockerSnap.val() || {};

    // Check online
    await assertLockerOnline(lockerId);

    // Check cảm biến cửa (nếu có)
    const doorState = String(locker.doorState || "").toLowerCase();
    if (doorState === "opened" || doorState === "open") {
      return res.status(409).json({ error: "Cửa tủ đang mở sẵn, hãy bỏ hàng vào." });
    }

    // --- BẮT ĐẦU GỬI LỆNH QUA TRANSACTION ---
    const cmdId = makeCommandId();
    const now = Date.now();

    const result = await lockerRef.child("command").transaction((current) => {
      // Nếu đang có lệnh PENDING, không cho gửi thêm lệnh mới
      if (current && current.status === "PENDING") return; 

      return {
        id: cmdId,
        action: "open",
        status: "PENDING",
        issuedAt: now,
        reservationId: reservationId,
        by: "shipper"
      };
    });

    if (!result.committed) {
      return res.status(409).json({ error: "Tủ đang xử lý một lệnh khác, vui lòng đợi vài giây." });
    }

    // 4. Đợi phản hồi từ ESP32 (waitAck)
    const ack = await waitAck(lockerId, cmdId); 

    if (!ack) {
      // Nếu timeout, nên xóa lệnh PENDING để giải phóng tủ cho lần thử sau
      await lockerRef.child("command").remove();
      return res.status(504).json({ error: "Tủ không phản hồi. Vui lòng kiểm tra kết nối của tủ." });
    }

    if (ack.status === "FAILED") {
      return res.status(500).json({ error: "Tủ báo lỗi vật lý khi mở khóa." });
    }

    // 5. Thành công -> Update trạng thái đơn và Log
    // Lưu ý: Lúc này status đơn vẫn là "booked" hoặc chuyển sang "loading" 
    // Trạng thái "loaded" chỉ nên set khi ESP32 báo cửa đã ĐÓNG lại.
    const updates = {};
  //  updates[`/Reservations/${reservationId}/status`] = "shipping"; // Đang trong quá trình bỏ hàng
    updates[`/Reservations/${reservationId}/shipperOpenedAt`] = now;
    
    await db.ref().update(updates);

    await db.ref("/Logs").push().set({
      phone: "shipper",
      locker: lockerId,
      action: "open_by_shipper_success",
      timestamp: now,
      result: "success",
      reservationId,
      bookingKey
    });

    return res.json({ 
      success: true, 
      message: "Tủ đã mở. Vui lòng bỏ hàng và ĐÓNG CỬA để hoàn tất." 
    });

  } catch (err) {
    console.error("[shipper/use-reservation] Error:", err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

//11.ship đóng tủ
  app.post("/api/shipper/confirm-loaded", async (req, res) => {
    const codeStr = String(req.body?.bookingCode ?? "").trim();
    const lockerId = String(req.body?.lockerId ?? "").trim().toUpperCase();
  
    if (!codeStr || !lockerId) {
      return res.status(400).json({ error: "Thiếu Booking Code hoặc Locker ID" });
    }
  
    try {
      const bookingKey = `${lockerId}_${codeStr}`;
      
      // 1. Tìm Reservation (Chỉ đọc - Once)
      const snap = await db.ref("/Reservations")
        .orderByChild("bookingKey")
        .equalTo(bookingKey)
        .once("value");
  
      const all = snap.val();
      if (!all) return res.status(400).json({ error: "Mã đặt tủ không tồn tại." });
  
      const [reservationId, cur] = Object.entries(all)
        .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))[0];
  
      // 2. Kiểm tra Logic (Status & Expiry)
      if (cur.status !== "booked" && cur.status !== "shipping") {
        return res.status(400).json({ error: `Đơn đang ở trạng thái ${cur.status}, không thể xác nhận.` });
      }
      if (Date.now() > Number(cur.expiresAt)) {
        return res.status(400).json({ error: "Đơn đặt tủ đã hết hạn." });
      }
  
      // 3. Kiểm tra Sensor trước khi cho phép đóng (Nếu có cảm biến)
      const lockerSnap = await db.ref(`/Lockers/${lockerId}`).once("value");
      const locker = lockerSnap.val() || {};
  
      // Check Online
      await assertLockerOnline(lockerId);
  
      // QUAN TRỌNG: Kiểm tra cảm biến hàng hóa (hasItem)
      if (locker.hasItem === false) {
        return res.status(409).json({ 
          error: "Cảm biến chưa thấy hàng! Vui lòng bỏ hàng vào đúng vị trí." 
        });
      }

      const doorState = String(locker.doorState || "").trim(); // nếu có
      if (doorState && doorState !== "opened") {//tồn tại và khác opened
        return res.status(409).json({
          error: "Cửa chưa mở. Vui lòng mở cửa tủ trước khi xác nhận."
        });
      }
  
      // 4. Gửi lệnh ĐÓNG TỦ (CLOSE)
      const cmdId = makeCommandId();
      const now = Date.now();
      const lockerRef = lockerRefById(lockerId);
  
  /*    // Ghi lệnh chờ đóng
      await lockerRef.update({
        command: {
          id: cmdId,
          action: "close",
          status: "PENDING",
          issuedAt: now,
          reservationId: reservationId
        }
      });*/

      //Transaction giúp bạn đảm bảo quy tắc quan trọng nhất: một locker chỉ có tối đa 1 command PENDING tại một thời điểm.
      const tx = await lockerRef.child("command").transaction((current) => {
        if (current && current.status === "PENDING") return; // đang bận
        return {
          id: cmdId,
          action: "close",
          status: "PENDING",
          issuedAt: now,
          reservationId,
          by: "shipper_confirm_loaded"
        };
      });
      
      if (!tx.committed) {
        return res.status(409).json({ error: "Tủ đang xử lý lệnh khác, vui lòng đợi vài giây." });
      }
  
      // 5. Đợi ESP32 xác nhận đã đóng cửa thành công (waitAck)
      const ack = await waitAck(lockerId, cmdId, 15000); // Đợi 15s cho shipper kịp đóng cửa
  
      if (!ack) {
        return res.status(504).json({ error: "Tủ không phản hồi. Hãy chắc chắn bạn đã đóng chặt cửa tủ." });
      }
  
      if (ack.status === "FAILED") {
        return res.status(500).json({ error: "Lỗi vật lý: Không thể chốt khóa." });
      }
  
      // 6. Hoàn tất: Tạo OTP người nhận và Update toàn bộ trạng thái
      const pickupOtp = Math.floor(100000 + Math.random() * 900000).toString();
      
      const updates = {};
      // Cập nhật Reservation
      updates[`/Reservations/${reservationId}/status`] = "loaded";
      updates[`/Reservations/${reservationId}/loadedAt`] = now;
      updates[`/Reservations/${reservationId}/pickupOtp`] = pickupOtp;
      updates[`/Reservations/${reservationId}/otpCode`] = pickupOtp; // fallback
  
      // Cập nhật Locker
      updates[`/Lockers/${lockerId}/status`] = "loaded"; // Đã có hàng bên trong
      updates[`/Lockers/${lockerId}/command`] = null; // Dọn dẹp lệnh
  
      await db.ref().update(updates);
  
      // 7. Log
      await db.ref("/Logs").push().set({
        locker: lockerId,
        action: "confirm_loaded_success_byshipper",
        timestamp: now,
        reservationId,
        bookingKey
      });
  
      console.log(`📱 [SMS Simulation] OTP cho khách: ${pickupOtp}`);
  
      return res.json({ 
        success: true, 
        message: "Xác nhận thành công. OTP đã được gửi cho người nhận." 
      });
  
    } catch (err) {
      console.error("[confirm-loaded] Error:", err);
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
  });




//12.nguoidung dong tu
app.post("/api/user/close-locker", authenticateToken, async (req, res) => {
  const phoneNumber = String(req.user?.phoneNumber || "").trim();
  if (!phoneNumber) return res.status(401).json({ error: "Unauthorized" });
  const now = Date.now();

  try {
    // 1. Tìm đơn hàng đang trạng thái 'opened' của User này
    const snap = await db.ref("/Reservations")
      .orderByChild("receiverPhone")
      .equalTo(phoneNumber)
      .once("value");

    const all = snap.val() || {};
    const openedEntries = Object.entries(all)
      .filter(([id, r]) => r.status === "opened")
      .sort((a, b) => (b[1].openedAt || 0) - (a[1].openedAt || 0));

    if (openedEntries.length === 0) {
      return res.status(400).json({ error: "Bạn không có tủ nào đang chờ đóng." });
    }

    const [reservationId, cur] = openedEntries[0];
    const lockerId = cur.lockerId;


    // --- THÊM DÒNG NÀY ĐỂ LẤY BIẾN locker ---
    const lockerSnap = await db.ref(`/Lockers/${lockerId}`).once("value");
    if (!lockerSnap.exists()) {
      return res.status(404).json({ error: "Không tìm thấy tủ." });
    }
    // ---------------------------------------

    // 2. Kiểm tra Online trước khi gửi lệnh
    await assertLockerOnline(lockerId);


    // QUAN TRỌNG: Kiểm tra cảm biến hàng hóa (hasItem)

    
// 3) Check cảm biến hàng hóa
const hasItem = lockerSnap.child("hasItem").val();
    if (hasItem === true) {
      return res.status(409).json({ 
        error: "Vẫn còn hàng trong tủ.Qúy khách vui lòng kiểm tra lại" 
      });
    }

    // 3. Gửi lệnh ĐÓNG TỦ (CLOSE) qua Transaction hoặc Update
    const cmdId = makeCommandId();
    const lockerRef = lockerRefById(lockerId);
/*
    await lockerRef.child("command").set({
      id: cmdId,
      action: "CLOSE_FINAL", // Cư dân đóng để kết thúc
      status: "PENDING",
      issuedAt: now,
      reservationId: reservationId
    });
*/
const tx = await lockerRef.child("command").transaction((current) => {
  // Nếu đang có lệnh chờ xử lý thì không cho ghi đè
  if (current && current.status === "PENDING") return;

  return {
    id: cmdId,
    action: "close", // Cư dân đóng để kết thúc
    status: "PENDING",
    issuedAt: now,
    reservationId: reservationId,
    by: "user"
  };
});

if (!tx.committed) {
  return res.status(409).json({
    error: "Tủ đang xử lý lệnh trước đó, vui lòng đợi vài giây rồi thử lại."
  });
}




    // 4. Đợi ESP32 xác nhận (WaitAck) - Đảm bảo tủ ĐÃ KHÓA THẬT
    const ack = await waitAck(lockerId, cmdId );

    if (!ack) {
      return res.status(504).json({ 
        error: "Tủ không phản hồi. Vui lòng đóng chặt cửa và thử lại." 
      });
    }

    if (ack.status === "FAILED") {
      return res.status(500).json({ error: "Lỗi vật lý: Khóa không thể chốt." });
    }

    // 5. ATOMIC UPDATE: Cập nhật nhiều node cùng lúc (Multi-path Update)
    // Thay thế hoàn toàn cho Transaction
    const updates = {};
    
    // Kết thúc đơn hàng
    updates[`/Reservations/${reservationId}/status`] = "done";
    updates[`/Reservations/${reservationId}/closedAt`] = now;

    // Giải phóng tủ về trạng thái trống (Idle)
    updates[`/Lockers/${lockerId}/status`] = "idle";
    updates[`/Lockers/${lockerId}/reservationId`] = null;
    updates[`/Lockers/${lockerId}/reservedBy`] = null;
    updates[`/Lockers/${lockerId}/command`] = null; // Dọn dẹp lệnh đã xong
    updates[`/Lockers/${lockerId}/last_update`] = now;

    await db.ref().update(updates);

    // 6. Log hành động
    await db.ref("/Logs").push().set({
      phone: phoneNumber,
      locker: lockerId,
      action: "close_by_user_success",
      timestamp: now,
      result: "success",
      reservationId
    });

    return res.json({
      success: true,
      message: "Cảm ơn bạn đã sử dụng dịch vụ. Tủ đã được đóng ."
    });

  } catch (err) {
    console.error("[user/close-locker] Error:", err);
    return res.status(err.statusCode || 500).json({ 
      error: err.message || "Lỗi khi xử lý đóng tủ" 
    });
  }
});


// 13.Cư dân hủy đặt tủ (chỉ khi booked và chưa hết hạn)
app.post("/api/user/cancel-reservation", authenticateToken, async (req, res) => {
  try {
    const phoneNumber = String(req.user?.phoneNumber || "").trim();
    if (!phoneNumber) return res.status(401).json({ error: "Unauthorized" });

    const reservationId = String(req.body?.reservationId ?? "").trim();
    if (!reservationId) return res.status(400).json({ error: "reservationId required" });

    const reservationRef = db.ref(`/Reservations/${reservationId}`);

    // 1) đọc reservation
    const cur = (await reservationRef.once("value")).val();
    if (!cur) return res.status(404).json({ error: "Không tìm thấy đơn đặt tủ" });
    const lockerId = String(cur.lockerId || "").trim().toUpperCase();
if (!lockerId) return res.status(400).json({ error: "Reservation thiếu lockerId" });


    // 2) quyền
    if (String(cur.receiverPhone || "").trim() !== phoneNumber) {
      return res.status(403).json({ error: "Bạn không có quyền hủy đơn này" });
    }

    const now = Date.now();
    const st = String(cur.status || "").trim();

    // idempotent
    if (st === "cancelled") {
      return res.json({ success: true, reservationId, message: "Đơn đã được hủy trước đó." });
    }

    const expired = now > Number(cur.expiresAt || 0);

    // ✅ Case A: booked + expired => auto cancel + release locker
    if (st === "booked" && expired) {
      await reservationRef.update({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: phoneNumber,
        cancelReason: "expired_auto_cancel",
      });

      await lockerRefById(lockerId).update({
        status: "idle",
        reservationId: null,
        reservedBy: null,
        last_update: now,
        lastCommandAction: "release",
        lastCommandAt: now,
        lastCommandBy: phoneNumber,
        lastCommandReservationId: reservationId,
      });

      await db.ref("/Logs").push().set({
        phone: phoneNumber,
        locker: lockerId,
        action: "cancel_reservation_expired_auto",
        timestamp: now,
        result: "success",
        reservationId,
      });

      return res.json({
        success: true,
        reservationId,
        lockerId,
        message: "Đơn đã hết hạn nên hệ thống tự hủy và nhả tủ.",
      });
    }

    // ✅ Case B: booked + chưa hết hạn => hủy bình thường
    if (st === "booked" && !expired) {
      await reservationRef.update({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: phoneNumber,
        cancelReason: "user_cancel",
      });

      await lockerRefById(lockerId).update({
        status: "idle",
        reservationId: null,
        reservedBy: null,
        last_update: now,
        lastCommandAction: "release",
        lastCommandAt: now,
        lastCommandBy: phoneNumber,
        lastCommandReservationId: reservationId,
      });

      await db.ref("/Logs").push().set({
        phone: phoneNumber,
        locker: lockerId,
        action: "cancel_reservation_by_user",
        timestamp: now,
        result: "success",
        reservationId,
      });

      return res.json({ success: true, reservationId, lockerId, message: "Đã hủy đặt tủ và nhả tủ." });
    }

    // ❗ Case C: không cho hủy các trạng thái khác (loaded/opened/closed/done…)
    // Nếu expired mà đã loaded/opened => để admin xử lý vì có thể có hàng
    if (expired) {
      return res.status(409).json({
        error: `Đơn đã hết hạn ở trạng thái '${st}'. Vui lòng liên hệ admin để xử lý (có thể còn hàng trong tủ).`,
      });
    }

    return res.status(409).json({ error: `Không thể hủy vì đơn đang ở trạng thái '${st}'.` });
  } catch (err) {
    console.error("[user/cancel-reservation] Error:", err);
    return res.status(500).json({ error: "Lỗi khi hủy đặt tủ" });
  }
});



//14. GET /api/admin/overdue-table
app.get("/api/admin/overdue-table", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();
      // ✅ Realtime: vừa admin mở bảng là quét & gắn cờ luôn
      await flagOverdueReservations();

    // Lấy các đơn đã gắn cờ needAdminPickup=true (do job quét quá hạn)
    const snap = await db.ref("/Reservations")
      .orderByChild("needAdminPickup")
      .equalTo(true)
      .once("value");

    const all = snap.val() || {};
    const list = Object.entries(all)
      .map(([id, r]) => ({ id, ...(r || {}) }))
      // chỉ lấy loaded/opened (có thể còn hàng)
      .filter(r => {
        const st = String(r.status || "").trim().toLowerCase();
        const exp = Number(r.expiresAt || 0);
        return exp > 0 && now > exp && ["loaded", "opened"].includes(st);
      })
      
      // sort quá hạn lâu nhất: expiresAt càng nhỏ càng lâu
      .sort((a, b) => (Number(a.expiresAt || 0) - Number(b.expiresAt || 0)));

    // Join thêm thông tin locker (doorState, hasItem)
    const rows = await Promise.all(list.map(async (r) => {
      const lockerId = String(r.lockerId || "").trim();
      let doorState = "";
      let hasItem = "";

      if (lockerId) {
        const locker = (await lockerRefById(lockerId).once("value")).val() || {};
        doorState = String(locker.doorState || "").trim();
        hasItem = parseHasItem(locker.hasItem);


      }

      return {
        reservationId: r.id,
        lockerId,
        doorState,
        hasItem,
        status: String(r.status || "").trim(),
        receiverPhone: String(r.receiverPhone || "").trim(),
        expiresAt: Number(r.expiresAt || 0),
        overdueMinutes: r.expiresAt ? Math.max(0, Math.floor((now - Number(r.expiresAt)) / 60000)) : null,
      };
    }));

    return res.json({ success: true, count: rows.length, rows });
  } catch (e) {
    console.error("[admin/overdue-table] error:", e);
    return res.status(500).json({ error: "Lỗi lấy danh sách đơn hết hạn" });
  }
});

//15.nut mở tủ
app.post("/api/admin/overdue/open", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const reservationId = String(req.body?.reservationId || "").trim();
    if (!reservationId) return res.status(400).json({ error: "reservationId required" });

    const reservationRef = db.ref(`/Reservations/${reservationId}`);
    const r = (await reservationRef.once("value")).val();
    if (!r) return res.status(404).json({ error: "Reservation not found" });

    const st = String(r.status || "").trim();
    if (!["loaded", "opened"].includes(st)) {
      return res.status(409).json({ error: `Trạng thái '${st}' không cho admin mở để thu hồi.` });
    }

    const now = Date.now();
    const expired = now > Number(r.expiresAt || 0);
    if (!(r.needAdminPickup === true || expired)) {
      return res.status(409).json({ error: "Đơn chưa hết hạn / chưa được gắn cờ thu hồi." });
    }

    const lockerId = String(r.lockerId || "").trim().toUpperCase();
    if (!lockerId) return res.status(400).json({ error: "Reservation thiếu lockerId" });

    const lockerRef = lockerRefById(lockerId);
    const locker = (await lockerRef.once("value")).val() || {};
    const doorState = String(locker.doorState || "").trim().toLowerCase();
    if (doorState && ["open", "opened", "opening"].includes(doorState)) {
      return res.status(409).json({ error: "Cửa đang mở sẵn, không gửi lệnh mở nữa." });
    }

        // 2) check online trước khi gửi lệnh
        await assertLockerOnline(lockerId);
    const adminPhone = String(req.user?.phoneNumber || "admin");
    const cmdId = makeCommandId();
      // 3) Gửi lệnh qua transaction để chặn chồng lệnh
      const tx = await lockerRef.child("command").transaction((current) => {
        if (current && current.status === "PENDING") return; // hủy tx
        return {
          id: cmdId,
          action: "open",
          status: "PENDING",
          issuedAt: now,
          reservationId,
          by: "admin",
          byPhone: adminPhone
        };
      });
      if (!tx.committed) {
        return res.status(409).json({ error: "Tủ đang xử lý lệnh khác, vui lòng đợi." });
      }

     // 4) Đợi ACK từ ESP32
     const ack = await waitAck(lockerId, cmdId);

     if (!ack) {
       // timeout -> dọn command nếu vẫn là cmdId của mình (tránh xóa nhầm lệnh mới)
       await lockerRef.child("command").transaction((cur) => {
         if (cur && cur.id === cmdId && cur.status === "PENDING") return null;
         return cur;
       });
       return res.status(504).json({ error: "Tủ không phản hồi. Vui lòng kiểm tra kết nối của tủ." });
     }
 
     if (ack.status === "FAILED") {
       // dọn command
       await lockerRef.child("command").transaction((cur) => {
         if (cur && cur.id === cmdId) return null;
         return cur;
       });
       return res.status(500).json({ error: "Tủ báo lỗi vật lý khi mở khóa." });
     }
 
     // 5) ACK OK -> atomic update + clear command
     const updates = {};
 
     // Reservation: ghi nhận admin đã mở để thu hồi (không bắt buộc đổi status)
     updates[`/Reservations/${reservationId}/adminOpenedAt`] = now;
     updates[`/Reservations/${reservationId}/adminOpenedBy`] = adminPhone;
 
     // Locker: clear command + audit
     updates[`/Lockers/${lockerId}/command`] = null;
     updates[`/Lockers/${lockerId}/last_update`] = now;
     updates[`/Lockers/${lockerId}/lastCommandAction`] = "open";
     updates[`/Lockers/${lockerId}/lastCommandAt`] = now;
     updates[`/Lockers/${lockerId}/lastCommandBy`] = adminPhone;
     updates[`/Lockers/${lockerId}/lastCommandReservationId`] = reservationId;
 
     await db.ref().update(updates);
 
     // 6) log
     await db.ref("/Logs").push().set({
       phone: adminPhone,
       locker: lockerId,
       action: "admin_open_overdue_success",
       timestamp: now,
       result: "success",
       reservationId,
       cmdId
     });
 
     return res.json({
       success: true,
       lockerId,
       reservationId,
       message: "Đã mở tủ (ACK thành công)."
     });
   } catch (e) {
     console.error("[admin/overdue/open] error:", e);
     return res.status(e.statusCode || 500).json({ error: e.message || "Lỗi mở tủ" });
   }
 });


//16.nut đóng tủ

app.post("/api/admin/overdue/close", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const reservationId = String(req.body?.reservationId || "").trim();
    if (!reservationId) return res.status(400).json({ error: "reservationId required" });

    const r = (await db.ref(`/Reservations/${reservationId}`).once("value")).val();
    if (!r) return res.status(404).json({ error: "Reservation not found" });

    const lockerId = String(r.lockerId || "").trim().toUpperCase();
    if (!lockerId) return res.status(400).json({ error: "Reservation thiếu lockerId" });

    const lockerRef = lockerRefById(lockerId);
    const locker = (await lockerRef.once("value")).val() || {};
    const doorState = String(locker.doorState || "").trim().toLowerCase();

    // Nếu có cảm biến và đã đóng rồi -> báo OK luôn
    if (doorState && ["closed", "close", "closing"].includes(doorState)) {
      return res.json({ success: true, lockerId, reservationId, message: "Cửa đã đóng sẵn." });
    }
 // check online trước khi gửi lệnh
 await assertLockerOnline(lockerId);

 const now = Date.now();
 const adminPhone = String(req.user?.phoneNumber || "admin");
 const cmdId = makeCommandId();

 // gửi lệnh qua transaction để chặn chồng lệnh
 const tx = await lockerRef.child("command").transaction((current) => {
   if (current && current.status === "PENDING") return; // đang bận
   return {
     id: cmdId,
     action: "close",
     status: "PENDING",
     issuedAt: now,
     reservationId,
     by: "admin",
     byPhone: adminPhone
   };
 });

 if (!tx.committed) {
   return res.status(409).json({ error: "Tủ đang xử lý lệnh khác, vui lòng đợi." });
 }

 // đợi ack
 const ack = await waitAck(lockerId, cmdId);

 if (!ack) {
   // timeout -> dọn command nếu vẫn là cmd của mình
   await lockerRef.child("command").transaction((cur) => {
     if (cur && cur.id === cmdId && cur.status === "PENDING") return null;
     return cur;
   });
   return res.status(504).json({ error: "Tủ không phản hồi. Vui lòng kiểm tra kết nối của tủ." });
 }

 if (ack.status === "FAILED") {
   await lockerRef.child("command").transaction((cur) => {
     if (cur && cur.id === cmdId) return null;
     return cur;
   });
   return res.status(500).json({ error: "Tủ báo lỗi vật lý khi đóng." });
 }

 // ACK OK -> cập nhật + clear command
 const updates = {};
 updates[`/Reservations/${reservationId}/adminClosedAt`] = now;
 updates[`/Reservations/${reservationId}/adminClosedBy`] = adminPhone;

 updates[`/Lockers/${lockerId}/command`] = null;
 updates[`/Lockers/${lockerId}/last_update`] = now;
 updates[`/Lockers/${lockerId}/lastCommandAction`] = "close";
 updates[`/Lockers/${lockerId}/lastCommandAt`] = now;
 updates[`/Lockers/${lockerId}/lastCommandBy`] = adminPhone;
 updates[`/Lockers/${lockerId}/lastCommandReservationId`] = reservationId;

 await db.ref().update(updates);

 await db.ref("/Logs").push().set({
   phone: adminPhone,
   locker: lockerId,
   action: "admin_close_overdue_success",
   timestamp: now,
   result: "success",
   reservationId,
   cmdId
 });

 return res.json({ success: true, lockerId, reservationId, message: "Đã đóng tủ (ACK thành công)." });
} catch (e) {
 console.error("[admin/overdue/close] error:", e);
 return res.status(e.statusCode || 500).json({ error: e.message || "Lỗi đóng tủ" });
}
});
   
//17.confirm
app.post("/api/admin/overdue/confirm-picked", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const reservationId = String(req.body?.reservationId || "").trim();
    if (!reservationId) return res.status(400).json({ error: "reservationId required" });

    const reservationRef = db.ref(`/Reservations/${reservationId}`);
    const r = (await reservationRef.once("value")).val();
    if (!r) return res.status(404).json({ error: "Reservation not found" });

    const st = String(r.status || "").trim();
    if (!["loaded", "opened"].includes(st)) {
      // idempotent
      if (["cleared", "done", "closed"].includes(st)) {
        return res.json({ success: true, reservationId, message: "Đơn đã được xử lý trước đó." });
      }
      return res.status(409).json({ error: `Không thể xác nhận lấy hàng khi trạng thái '${st}'.` });
    }

    const lockerId = String(r.lockerId || "").trim().toUpperCase();
    if (!lockerId) return res.status(400).json({ error: "Reservation thiếu lockerId" });

    const now = Date.now();
    const adminPhone = String(req.user?.phoneNumber || "admin");

    const lockerRef = lockerRefById(lockerId);

    // 0) check online trước khi gửi lệnh close
    await assertLockerOnline(lockerId);

    // 1) gửi lệnh CLOSE qua transaction (chặn chồng lệnh)
    const cmdId = makeCommandId();
    const tx = await lockerRef.child("command").transaction((current) => {
      if (current && current.status === "PENDING") return;
      return {
        id: cmdId,
        action: "close",
        status: "PENDING",
        issuedAt: now,
        reservationId,
        by: "admin_confirm_picked",
        byPhone: adminPhone
      };
    });

    if (!tx.committed) {
      return res.status(409).json({ error: "Tủ đang xử lý lệnh khác, vui lòng đợi." });
    }

    // 2) đợi ACK
    const ack = await waitAck(lockerId, cmdId);

    if (!ack) {
      // timeout -> dọn command nếu vẫn là lệnh của mình
      await lockerRef.child("command").transaction((cur) => {
        if (cur && cur.id === cmdId && cur.status === "PENDING") return null;
        return cur;
      });
      return res.status(504).json({ error: "Tủ không phản hồi khi đóng. Vui lòng thử lại." });
    }

    if (ack.status === "FAILED") {
      await lockerRef.child("command").transaction((cur) => {
        if (cur && cur.id === cmdId) return null;
        return cur;
      });
      return res.status(500).json({ error: "Lỗi vật lý: Không thể chốt khóa khi đóng tủ." });
    }

    // 3) ACK OK -> multipath update: reservation cleared + nhả locker idle + clear command
    const updates = {};

    // Reservation
    updates[`/Reservations/${reservationId}/status`] = "cleared"; // hoặc "done" tuỳ bạn
    updates[`/Reservations/${reservationId}/clearedAt`] = now;
    updates[`/Reservations/${reservationId}/needAdminPickup`] = false;
    updates[`/Reservations/${reservationId}/needAdminPickupAt`] = null;
    updates[`/Reservations/${reservationId}/adminPickupStatus`] = "picked";
    updates[`/Reservations/${reservationId}/adminPickupPickedAt`] = now;
    updates[`/Reservations/${reservationId}/adminPickupBy`] = adminPhone;

    // Locker: nhả về idle
    updates[`/Lockers/${lockerId}/status`] = "idle";
    updates[`/Lockers/${lockerId}/reservationId`] = null;
    updates[`/Lockers/${lockerId}/reservedBy`] = null;
    updates[`/Lockers/${lockerId}/command`] = null;
    updates[`/Lockers/${lockerId}/last_update`] = now;
    updates[`/Lockers/${lockerId}/lastCommandAction`] = "close";
    updates[`/Lockers/${lockerId}/lastCommandAt`] = now;
    updates[`/Lockers/${lockerId}/lastCommandBy`] = adminPhone;
    updates[`/Lockers/${lockerId}/lastCommandReservationId`] = reservationId;

    await db.ref().update(updates);

    // 4) log
    await db.ref("/Logs").push().set({
      phone: adminPhone,
      locker: lockerId,
      action: "admin_confirm_picked_overdue_success",
      timestamp: now,
      result: "success",
      reservationId,
      cmdId
    });

    return res.json({ success: true, reservationId, lockerId, message: "Đã xác nhận lấy hàng và nhả tủ (đóng ACK OK)." });
  } catch (e) {
    console.error("[admin/overdue/confirm-picked] error:", e);
    return res.status(e.statusCode || 500).json({ error: e.message || "Lỗi xác nhận lấy hàng" });
  }
});













// =======================
// 17. Serve static HTML files
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
//17 api