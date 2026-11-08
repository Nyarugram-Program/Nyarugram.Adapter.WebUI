export interface MilkyApiItem {
  action: string
  description: string
  requiresAccount: boolean
  requestExample: Record<string, unknown>
  responseExample: Record<string, unknown>
}

export const milkyApis: MilkyApiItem[] = [
  {
    action: 'get_login_info',
    description: '查询当前登录身份',
    requiresAccount: true,
    requestExample: {},
    responseExample: { uin: 100001, nickname: '示例用户' }
  },
  {
    action: 'get_impl_info',
    description: '查询适配器实现信息',
    requiresAccount: false,
    requestExample: {},
    responseExample: {
      impl_name: 'nyarugram-milky',
      impl_version: '0.1.0',
      milky_version: '1.3'
    }
  },
  {
    action: 'get_user_profile',
    description: '查询用户资料',
    requiresAccount: true,
    requestExample: { user_id: 100002 },
    responseExample: { profile: {} }
  },
  {
    action: 'get_friend_list',
    description: '查询好友列表',
    requiresAccount: true,
    requestExample: {},
    responseExample: { friends: [] }
  },
  {
    action: 'get_friend_info',
    description: '查询好友信息',
    requiresAccount: true,
    requestExample: { user_id: 100002 },
    responseExample: { friend: {} }
  },
  {
    action: 'get_group_list',
    description: '查询群组列表',
    requiresAccount: true,
    requestExample: {},
    responseExample: { groups: [] }
  },
  {
    action: 'get_group_info',
    description: '查询群组信息',
    requiresAccount: true,
    requestExample: { group_id: 200001, no_cache: false },
    responseExample: { group: {} }
  },
  {
    action: 'get_group_member_list',
    description: '查询群成员列表',
    requiresAccount: true,
    requestExample: { group_id: 200001, no_cache: false },
    responseExample: { members: [] }
  },
  {
    action: 'get_group_member_info',
    description: '查询群成员信息',
    requiresAccount: true,
    requestExample: {
      group_id: 200001,
      user_id: 100002,
      no_cache: false
    },
    responseExample: { member: {} }
  },
  {
    action: 'send_private_message',
    description: '发送私聊消息',
    requiresAccount: true,
    requestExample: {
      user_id: 100002,
      message: [{ type: 'text', data: { text: 'Hello Milky' } }],
      nyarugram_idempotency_key: 'optional-unique-key'
    },
    responseExample: { message_seq: 1234, time: 1760000000 }
  },
  {
    action: 'send_group_message',
    description: '发送群聊消息',
    requiresAccount: true,
    requestExample: {
      group_id: 200001,
      message: [{ type: 'text', data: { text: 'Hello group' } }],
      nyarugram_idempotency_key: 'optional-unique-key'
    },
    responseExample: { message_seq: 1234, time: 1760000000 }
  },
  {
    action: 'get_message',
    description: '查询单条消息',
    requiresAccount: true,
    requestExample: {
      message_scene: 'friend',
      peer_id: 100002,
      message_seq: 1234
    },
    responseExample: { message: {} }
  },
  {
    action: 'get_history_messages',
    description: '查询历史消息',
    requiresAccount: true,
    requestExample: {
      message_scene: 'friend',
      peer_id: 100002,
      start_message_seq: 0,
      limit: 20
    },
    responseExample: { messages: [], next_message_seq: 0 }
  },
  {
    action: 'mark_message_as_read',
    description: '标记消息已读',
    requiresAccount: true,
    requestExample: {
      message_scene: 'friend',
      peer_id: 100002,
      message_seq: 1234
    },
    responseExample: {}
  },
  {
    action: 'nyarugram_get_capabilities',
    description: '查询 Nyarugram 能力',
    requiresAccount: false,
    requestExample: {},
    responseExample: { apis: [], calls: { voice: false } }
  },
  {
    action: 'nyarugram_start_call',
    description: '发起一对一呼叫',
    requiresAccount: true,
    requestExample: {
      user_id: 100002,
      video: false,
      request_id: 'unique-call-request'
    },
    responseExample: { call: {} }
  },
  {
    action: 'nyarugram_accept_call',
    description: '接听来电',
    requiresAccount: true,
    requestExample: { call_id: 'call-uuid', request_id: 'optional-id' },
    responseExample: { call: {} }
  },
  {
    action: 'nyarugram_end_call',
    description: '结束呼叫',
    requiresAccount: true,
    requestExample: {
      call_id: 'call-uuid',
      reason: 'hangup',
      request_id: 'optional-id'
    },
    responseExample: { call: {} }
  },
  {
    action: 'nyarugram_get_call',
    description: '查询呼叫状态',
    requiresAccount: true,
    requestExample: { call_id: 'call-uuid' },
    responseExample: { call: {} }
  }
]

export const milkyApiActions = milkyApis.map((item) => item.action)
