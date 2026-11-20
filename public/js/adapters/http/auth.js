/** auth.js - Adaptador HTTP de autenticación y cuenta */
import { get, post } from './client.js';

export const httpAuthAdapter = {
  async currentUser() {
    try { return (await get('/me')).user; } catch { return null; }
  },
  sendCode: (email, phone) => post('/auth/send-code', { email, phone }),
  register: (draft) => post('/auth/register', draft),
  login: (identifier, password) => post('/auth/login', { identifier, password }),
  async logout() { try { await post('/auth/logout', {}); } catch { /* ya sin sesión */ } return true; },
  requestPasswordReset: (identifier) => post('/auth/forgot', { identifier }),
  async resetPassword(identifier, newPassword, code) { await post('/auth/reset', { identifier, newPassword, code }); return true; },
  async checkPassword(password) { try { return (await post('/me/check-password', { password })).ok; } catch { return false; } },
  async changePassword(current, next) { await post('/me/password', { current, next }); return true; },
  requestEmailChange: (password, newEmail) => post('/me/email/request', { password, newEmail }),
  changeEmail: (password, newEmail, code) => post('/me/email', { password, newEmail, code }),
  requestPhoneChange: (password, newPhone) => post('/me/phone/request', { password, newPhone }),
  changePhone: (password, newPhone, code) => post('/me/phone', { password, newPhone, code }),
};
