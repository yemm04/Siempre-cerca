/**
 * auth.js - Servicio de autenticación y gestión de cuentas
 * Interfaz utilizada por las pantallas para registro, login y contraseñas.
 */
import { api } from './index.js';

export const authService = {
  currentUser: () => api.auth.currentUser(),
  sendCode: (email, phone) => api.auth.sendCode(email, phone),
  register: (draft) => api.auth.register(draft),
  login: (identifier, password) => api.auth.login(identifier, password),
  logout: () => api.auth.logout(),
  requestPasswordReset: (identifier) => api.auth.requestPasswordReset(identifier),
  resetPassword: (identifier, newPassword, code) => api.auth.resetPassword(identifier, newPassword, code),
  checkPassword: (password) => api.auth.checkPassword(password),
  changePassword: (cur, next) => api.auth.changePassword(cur, next),
  requestEmailChange: (curPw, newEmail) => api.auth.requestEmailChange(curPw, newEmail),
  changeEmail: (curPw, newEmail, code) => api.auth.changeEmail(curPw, newEmail, code),
  requestPhoneChange: (curPw, newPhone) => api.auth.requestPhoneChange(curPw, newPhone),
  changePhone: (curPw, newPhone, code) => api.auth.changePhone(curPw, newPhone, code),
};
