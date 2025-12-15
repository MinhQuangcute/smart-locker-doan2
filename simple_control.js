// Simple Control JavaScript - Điều khiển tủ khóa đơn giản
// Flow: Quét QR → Kết nối → Ấn nút điều khiển

let database, ref, onValue, set, get;
let isConnected = false;
let currentLockerId = null;
let currentStatus = 'closed';
let lastUpdateTime = null;

// DOM elements
const scanBtn = document.getElementById('scanBtn');
const qrPlaceholder = document.getElementById('qrPlaceholder');
const statusDisplay = document.getElementById('statusDisplay');
const controlButtons = document.getElementById('controlButtons');
const connectionStatus = document.getElementById('connectionStatus');
const lockerStatus = document.getElementById('lockerStatus');
const lastUpdate = document.getElementById('lastUpdate');
const activityList = document.getElementById('activityList');
const openBtn = document.getElementById('openBtn');
const closeBtn = document.getElementById('closeBtn');
const holdBtn = document.getElementById('holdBtn');

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Simple Control System initialized');
    
    // Wait for Firebase to be ready
    await waitForFirebase();
    
    // Setup event listeners
    scanBtn.addEventListener('click', startQRScan);
    
    // Add initial activity log
    addActivityLog('Hệ thống khởi động', 'system');
    
    // Update time every second
    setInterval(updateTime, 1000);
    
    // Check connection status
    setInterval(checkConnectionStatus, 5000);
});

// Wait for Firebase to be ready
function waitForFirebase() {
    return new Promise((resolve) => {
        const checkFirebase = () => {
            if (window.database && window.ref && window.onValue && window.set && window.get) {
                database = window.database;
                ref = window.ref;
                onValue = window.onValue;
                set = window.set;
                get = window.get;
                console.log('✅ Firebase v12 đã sẵn sàng');
                resolve();
            } else {
                setTimeout(checkFirebase, 100);
            }
        };
        checkFirebase();
    });
}

// Start QR scanning
function startQRScan() {
    console.log('📱 Bắt đầu quét QR code...');
    addActivityLog('Đang quét QR code...', 'info');
    
    // Simulate QR scanning (in real implementation, use a QR scanner library)
    scanBtn.disabled = true;
    scanBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang quét...';
    
    setTimeout(() => {
        // For demo purposes, use a mock locker ID
        const mockLockerId = 'Locker' + Math.floor(Math.random() * 10 + 1);
        handleQRScanResult(mockLockerId);
    }, 2000);
}

// Handle QR scan result
function handleQRScanResult(lockerId) {
    currentLockerId = lockerId;
    console.log('📱 Đã quét thành công! Locker ID:', lockerId);
    
    // Update UI
    qrPlaceholder.innerHTML = `
        <div style="color: #28a745;">
            <i class="fas fa-check-circle" style="font-size: 64px;"></i>
            <p style="margin-top: 10px; font-weight: bold;">Đã kết nối!</p>
            <p style="font-size: 14px;">Locker: ${lockerId}</p>
        </div>
    `;
    
    scanBtn.innerHTML = '<i class="fas fa-sync"></i> Quét lại';
    scanBtn.disabled = false;
    
    // Show status and controls
    statusDisplay.style.display = 'block';
    controlButtons.style.display = 'grid';
    
    // Start listening to Firebase
    startFirebaseListener();
    
    addActivityLog(`Đã kết nối với Locker: ${lockerId}`, 'success');
}

// Start Firebase listener
function startFirebaseListener() {
    console.log('📡 Bắt đầu lắng nghe Firebase...');
    
    try {
        // Listen to locker status changes
        const lockerRef = ref(database, `/Lockers/${currentLockerId}`);
        
        onValue(lockerRef, (snapshot) => {
            const data = snapshot.val();
            console.log('📨 Nhận dữ liệu từ Firebase:', data);
            
            if (data) {
                updateLockerStatus(data);
                isConnected = true;
                updateConnectionStatus(true);
            } else {
                console.log('⚠️ Không có dữ liệu từ Firebase');
                addActivityLog('Không có dữ liệu từ Firebase', 'error');
            }
        }, (error) => {
            console.error('❌ Lỗi Firebase:', error);
            isConnected = false;
            updateConnectionStatus(false);
            addActivityLog('Lỗi kết nối Firebase: ' + (error.message || error), 'error');
        });
        
        // Test connection
        const connectedRef = ref(database, '.info/connected');
        onValue(connectedRef, (snapshot) => {
            const connected = snapshot.val();
            console.log('🔗 Trạng thái kết nối Firebase:', connected);
            if (connected) {
                addActivityLog('Firebase đã kết nối', 'success');
            } else {
                addActivityLog('Firebase mất kết nối', 'error');
            }
        });
        
    } catch (error) {
        console.error('❌ Lỗi khởi tạo listener:', error);
        addActivityLog('Lỗi khởi tạo listener: ' + error.message, 'error');
    }
}

// Update locker status display
function updateLockerStatus(data) {
    const status = data.status || 'unknown';
    const lastUpdateVal = data.lastUpdate || Date.now();
    
    currentStatus = status;
    lastUpdateTime = new Date(parseInt(lastUpdateVal));
    
    // Update status display
    lockerStatus.textContent = getStatusText(status);
    lockerStatus.className = getStatusClass(status);
    
    // Update buttons
    updateButtonStates(status);
    
    // Update last update time
    updateLastUpdateTime();
    
    addActivityLog(`Trạng thái tủ: ${getStatusText(status)}`, 'info');
}

// Get status text
function getStatusText(status) {
    switch(status) {
        case 'open': return 'Mở';
        case 'closed': return 'Đóng';
        case 'empty': return 'Trống';
        case 'reserved': return 'Đã đặt trước';
        case 'occupied': return 'Đang sử dụng';
        default: return status;
    }
}

// Get status class
function getStatusClass(status) {
    switch(status) {
        case 'open': return 'text-success';
        case 'closed': return 'text-danger';
        case 'empty': return 'text-info';
        case 'reserved': return 'text-warning';
        case 'occupied': return 'text-primary';
        default: return 'text-muted';
    }
}

// Update button states
function updateButtonStates(status) {
    // Enable/disable buttons based on current status
    if (status === 'open') {
        closeBtn.disabled = false;
        openBtn.disabled = true;
        holdBtn.disabled = false;
    } else if (status === 'closed') {
        openBtn.disabled = false;
        closeBtn.disabled = true;
        holdBtn.disabled = false;
    } else {
        openBtn.disabled = false;
        closeBtn.disabled = false;
        holdBtn.disabled = false;
    }
}

// Control locker function
function controlLocker(action) {
    console.log(`🎮 Yêu cầu điều khiển tủ: ${action}`);
    
    if (!currentLockerId) {
        addActivityLog('Chưa kết nối với tủ khóa', 'error');
        return;
    }
    
    // Show processing state
    const button = document.getElementById(action + 'Btn');
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang xử lý...';
    button.disabled = true;
    
    try {
        // Send command to Firebase
        sendCommandToFirebase(action);
        addActivityLog(`Đã gửi lệnh: ${action}`, 'user');
        
    } catch (error) {
        console.error('❌ Lỗi gửi lệnh:', error);
        addActivityLog('Lỗi gửi lệnh: ' + error.message, 'error');
    } finally {
        // Reset button after 2 seconds
        setTimeout(() => {
            button.innerHTML = originalText;
            button.disabled = false;
        }, 2000);
    }
}

// Send command to Firebase
async function sendCommandToFirebase(action) {
    try {
        const commandRef = ref(database, `/Commands/${currentLockerId}`);
        const command = {
            cmd: action,
            by: 'web_user',
            ts: Date.now(),
            approvedBy: 'web_control'
        };
        
        await set(commandRef, command);
        console.log('✅ Đã gửi lệnh lên Firebase:', command);
        
    } catch (error) {
        console.error('❌ Lỗi gửi lệnh lên Firebase:', error);
        throw error;
    }
}

// Update connection status
function updateConnectionStatus(connected) {
    const statusIndicator = connectionStatus.querySelector('.status-indicator');
    const statusText = connectionStatus.querySelector('span:last-child');
    
    if (connected) {
        statusIndicator.className = 'status-indicator status-online';
        statusText.textContent = 'Đã kết nối';
    } else {
        statusIndicator.className = 'status-indicator status-offline';
        statusText.textContent = 'Mất kết nối';
    }
}

// Check connection status
function checkConnectionStatus() {
    const connected = navigator.onLine && isConnected;
    updateConnectionStatus(connected);
}

// Add activity log
function addActivityLog(message, type = 'info') {
    const now = new Date();
    const timeString = now.toLocaleTimeString('vi-VN');
    
    const activityItem = document.createElement('div');
    activityItem.className = 'activity-item';
    
    const icon = getActivityIcon(type);
    activityItem.innerHTML = `
        <span class="time">${timeString}</span>
        <span>${icon} ${message}</span>
    `;
    
    // Add to top of list
    activityList.insertBefore(activityItem, activityList.firstChild);
    
    // Keep only last 20 items
    while (activityList.children.length > 20) {
        activityList.removeChild(activityList.lastChild);
    }
}

// Get activity icon
function getActivityIcon(type) {
    switch(type) {
        case 'user': return '👤';
        case 'system': return '⚙️';
        case 'error': return '❌';
        case 'success': return '✅';
        case 'info': return 'ℹ️';
        default: return '📝';
    }
}

// Update time display
function updateTime() {
    if (lastUpdateTime) {
        const now = new Date();
        const diff = Math.floor((now - lastUpdateTime) / 1000);
        
        if (diff < 60) {
            lastUpdate.textContent = `${diff}s trước`;
        } else if (diff < 3600) {
            lastUpdate.textContent = `${Math.floor(diff / 60)}m trước`;
        } else {
            lastUpdate.textContent = lastUpdateTime.toLocaleTimeString('vi-VN');
        }
    }
}

// Update last update time
function updateLastUpdateTime() {
    if (lastUpdateTime) {
        lastUpdate.textContent = lastUpdateTime.toLocaleTimeString('vi-VN');
    }
}

// Handle online/offline events
window.addEventListener('online', () => {
    console.log('🌐 Kết nối internet đã được khôi phục');
    addActivityLog('Kết nối internet đã được khôi phục', 'success');
});

window.addEventListener('offline', () => {
    console.log('🌐 Mất kết nối internet');
    addActivityLog('Mất kết nối internet', 'error');
    updateConnectionStatus(false);
});

// Keyboard shortcuts
document.addEventListener('keydown', function(event) {
    if (event.ctrlKey || event.metaKey) {
        switch(event.key) {
            case 'o':
                event.preventDefault();
                if (!openBtn.disabled) controlLocker('open');
                break;
            case 'c':
                event.preventDefault();
                if (!closeBtn.disabled) controlLocker('close');
                break;
            case 'h':
                event.preventDefault();
                if (!holdBtn.disabled) controlLocker('hold');
                break;
        }
    }
});

// Add keyboard shortcut info
addActivityLog('Phím tắt: Ctrl+O (Mở), Ctrl+C (Đóng), Ctrl+H (Giữ)', 'system');
































