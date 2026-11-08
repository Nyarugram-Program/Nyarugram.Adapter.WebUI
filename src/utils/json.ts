const whitespace = /\s/

export function parseJson(text: string): unknown {
  let index = 0

  const fail = (message: string): never => {
    throw new Error(`${message}（位置 ${index}）`)
  }

  const skipWhitespace = () => {
    while (index < text.length && whitespace.test(text[index])) index += 1
  }

  const parseString = (): string => {
    if (text[index] !== '"') fail('JSON 字符串必须以双引号开始')
    const start = index
    index += 1
    while (index < text.length) {
      const char = text[index]
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === '"') {
        index += 1
        return JSON.parse(text.slice(start, index)) as string
      }
      index += 1
    }
    return fail('JSON 字符串未闭合')
  }

  const parseNumber = (): number | bigint => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      text.slice(index)
    )
    if (!match) return fail('JSON 数字格式错误')
    index += match[0].length
    if (/[.eE]/.test(match[0])) return Number(match[0])
    const value = Number(match[0])
    if (!Number.isSafeInteger(value)) return BigInt(match[0])
    return value
  }

  const parseLiteral = (literal: string, value: unknown): unknown => {
    if (!text.startsWith(literal, index)) fail(`JSON 字面量 ${literal} 错误`)
    index += literal.length
    return value
  }

  const parseArray = (): unknown[] => {
    index += 1
    const result: unknown[] = []
    skipWhitespace()
    if (text[index] === ']') {
      index += 1
      return result
    }
    while (index < text.length) {
      result.push(parseValue())
      skipWhitespace()
      if (text[index] === ',') {
        index += 1
        skipWhitespace()
        continue
      }
      if (text[index] === ']') {
        index += 1
        return result
      }
      fail('JSON 数组缺少逗号或右括号')
    }
    return fail('JSON 数组未闭合')
  }

  const parseObject = (): Record<string, unknown> => {
    index += 1
    const result: Record<string, unknown> = {}
    skipWhitespace()
    if (text[index] === '}') {
      index += 1
      return result
    }
    while (index < text.length) {
      skipWhitespace()
      const key = parseString()
      skipWhitespace()
      if (text[index] !== ':') fail('JSON 对象缺少冒号')
      index += 1
      result[key] = parseValue()
      skipWhitespace()
      if (text[index] === ',') {
        index += 1
        skipWhitespace()
        continue
      }
      if (text[index] === '}') {
        index += 1
        return result
      }
      fail('JSON 对象缺少逗号或右括号')
    }
    return fail('JSON 对象未闭合')
  }

  const parseValue = (): unknown => {
    skipWhitespace()
    const char = text[index]
    if (char === '"') return parseString()
    if (char === '{') return parseObject()
    if (char === '[') return parseArray()
    if (char === 't') return parseLiteral('true', true)
    if (char === 'f') return parseLiteral('false', false)
    if (char === 'n') return parseLiteral('null', null)
    if (char === '-' || /\d/.test(char)) return parseNumber()
    return fail('无法解析 JSON 值')
  }

  const result = parseValue()
  skipWhitespace()
  if (index !== text.length) fail('JSON 末尾存在多余内容')
  return result
}

export function stringifyJson(value: unknown, space?: number): string {
  const indent = typeof space === 'number' ? ' '.repeat(space) : ''
  const newline = indent ? '\n' : ''

  const serialize = (input: unknown, level: number): string => {
    if (input === null) return 'null'
    if (typeof input === 'string') return JSON.stringify(input)
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('JSON 不支持非有限数值')
      return String(input)
    }
    if (typeof input === 'bigint') return input.toString()
    if (typeof input === 'boolean') return String(input)
    if (Array.isArray(input)) {
      if (input.length === 0) return '[]'
      const prefix = indent.repeat(level + 1)
      const body = input
        .map((item) => `${prefix}${serialize(item, level + 1)}`)
        .join(`,${newline}`)
      return `[${newline}${body}${newline}${indent.repeat(level)}]`
    }
    if (typeof input === 'object') {
      const entries = Object.entries(input as Record<string, unknown>)
      if (entries.length === 0) return '{}'
      const prefix = indent.repeat(level + 1)
      const body = entries
        .map(
          ([key, item]) =>
            `${prefix}${JSON.stringify(key)}:${indent ? ' ' : ''}${serialize(
              item,
              level + 1
            )}`
        )
        .join(`,${newline}`)
      return `{${newline}${body}${newline}${indent.repeat(level)}}`
    }
    throw new Error(`不支持序列化类型 ${typeof input}`)
  }

  return serialize(value, 0)
}

export const formatJsonText = (text: string) =>
  stringifyJson(parseJson(text), 2)
