# 代码诊断收件服务：合作来源契约

该来源是本地合成LSP 3.17语言服务，只使用Node内置TCP，不分析真实项目。`initialize`支持textDocumentSync和diagnosticProvider，帧是Content-Length包裹的JSON-RPC消息。客户端在initialized后才能请求资料。服务声明interFileDependencies=true、workspaceDiagnostics=true。

`textDocument/diagnostic`请求带textDocument.uri及可选previousResultId，结果分Full与Unchanged；Unchanged表示调用者已有对应resultId报告。Full诊断有severity、message、Range以及服务版本。`textDocument/didChange`推进文档版本。`workspace/diagnostic`使用partialResultToken通过`$/progress`逐批返回，最后用JSON-RPC response结束；正常模式中所有本地文件都能被报告。`startProvider({scenario:'partial'})`在收到取消时中止部分返回，不能误解为其余文件没有诊断。

诊断可能引用另一个文件；报告存储至少区分URI、文档版本、服务实例和resultId。每次TCP连接创建新的逻辑服务实例，连接断开后旧实例的resultId不能用于新实例。客户端可发送$/cancelRequest通知。增量响应仅用于重用既有完整报告，不能因为unchanged没有items就删除旧问题。连接使用Node net的字节流，单个JSON-RPC帧可能被分段、粘连。此服务只产生合成诊断，不执行项目代码、修复代码或接入外部语言服务器。

## 来源与支持范围

格式参考：`https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_diagnostic`。这里运行的是只含虚构资料的本地合作端，不是公网生产服务；只需支持本文明确给出的范围。来源实现和样例可以阅读，自动接入应使用声明的交互入口，不把服务内部对象或预先写好的采集结论当作数据来源。原始依据、结构化内容和完整性状态应能在收件端回查；新增自动接口的名称与内部设计由开发者决定。
