/** Kimi Code 风格 ASCII 欢迎横幅（README「缺失组件」清单第 1 项） */

const LOGO = [
  ' ____  _____ _____ ____  ____  _____ _____ _  __',
  '|  _ \\| ____| ____|  _ \\/ ___|| ____| ____| |/ /',
  '| | | |  _| |  _| | |_) \\___ \\|  _| |  _| | \' /',
  '| |_| | |___| |___|  __/ ___) | |___| |___| . \\',
  '|____/|_____|_____|_|    |____/|_____|_____|_|\\_\\',
  '',
  ' _   _    _    ____  _   _ _____ ____ ____',
  '| | | |  / \\  |  _ \\| \\ | | ____/ ___/ ___|',
  '| |_| | / _ \\ | |_) |  \\| |  _| \\___ \\___ \\',
  '|  _  |/ ___ \\|  _ <| |\\  | |___ ___) |__) |',
  '|_| |_/_/   \\_\\_| \\_\\_| \\_|_____|____/____/',
]

interface Props {
  directory: string
  sessionId: string
  model: string
  version: string
}

export function AsciiWelcome({ directory, sessionId, model, version }: Props) {
  return (
    <div className="welcome">
      <pre>{LOGO.join('\n')}</pre>
      <div className="info">
        <span>
          <span className="k">Directory: </span>
          <span className="v">~/tonghuashun-harness</span>
        </span>
        <span>
          <span className="k">Session: </span>
          <span className="v">{sessionId}</span>
        </span>
        <span>
          <span className="k">Model: </span>
          <span className="v">{model}</span>
        </span>
        <span>
          <span className="k">Version: </span>
          <span className="v">dsh {version}</span>
        </span>
      </div>
      <div className="hint">
        这里是 {directory} 的终端视图：K 线 = Token 消耗走势，最近变更 = 代码增删（红增绿删），分时成交 = 每分钟 Token 消耗。
        直接输入任务，或点左侧关注项目切换工作区。
      </div>
    </div>
  )
}
