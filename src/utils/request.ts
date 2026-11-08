import axios from 'axios'

/**
 * 协议调试使用显式目标地址，不经过任何管理入口或全局 baseURL。
 * 管理请求由各管理模式自己的客户端负责会话与 CSRF。
 */
export const request = axios.create({
  timeout: 10000
})
