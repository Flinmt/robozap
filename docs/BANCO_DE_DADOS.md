# Banco de Dados do ROBOZAP

Este documento descreve o contrato de banco necessário para o funcionamento completo do ROBOZAP: painel de fila, produtor, novo agendamento, confirmação, botão por URL, revalidação antes do envio e sincronização opcional de status.

O levantamento foi feito de duas formas:

- auditoria de todas as consultas em `src/repositories/messageRepository.js`;
- comparação com os metadados de uma instalação compatível, sem leitura de dados de pacientes e sem alterações no banco.

Os tipos e tamanhos são referências de compatibilidade encontradas em uma instalação real. Eles não representam uma cópia do schema completo do sistema de origem. Colunas usadas apenas pelo restante do sistema clínico estão fora do escopo.

Há três classificações neste documento:

- **núcleo**: necessária para produzir, selecionar, validar ou atualizar a fila;
- **recurso opcional**: alimenta uma configuração que pode ser ligada no painel;
- **extensão possível**: existe em schemas compatíveis e pode enriquecer o payload, mas exige alteração no código atual.

Uma coluna ligada a um recurso opcional pode continuar sendo obrigatória no schema. O SQL Server precisa resolver todas as colunas citadas na consulta, mesmo quando a flag correspondente está desligada.

## Objetos obrigatórios

| Objeto | Tipo | Obrigatório | Papel |
| --- | --- | --- | --- |
| `dbo.tblWhatsAppEnvio` | tabela | sim | Fila, snapshot e estado dos envios. |
| `dbo.vwAgenda` | view | sim | Dados atuais usados para produzir e revalidar a fila. |
| `dbo.tblAgenda` | tabela | sim | Resolve unidade; recebe status se a sincronização estiver ligada. |
| `dbo.tblEmpresa` | tabela | sim | Resolve o nome da empresa/unidade. |
| `dbo.fncBase64_Encode` | função escalar | sim no código atual | Gera o token usado no link de confirmação. É chamada mesmo quando o botão está desativado. |

## Recursos opcionais e dependências

| Configuração | Objetos/colunas usados pelo código atual | Efeito |
| --- | --- | --- |
| `queueProducerEnabled` | `vwAgenda` e todas as colunas de INSERT de `tblWhatsAppEnvio` | Cria a fila que, sem essa opção, precisa ser abastecida externamente. |
| `includeProcedure` | `tblWhatsAppEnvio.strProcedimento`, com fallback para `vwAgenda.strEspecialidadeMedica` | Acrescenta procedimento/especialidade ao corpo do template. |
| `includeCompany` | `vwAgenda.strEmpresa`, `vwAgenda.intEmpresaId`, `tblAgenda.intUnidadeId`, `tblEmpresa.intEmpresaId` e `tblEmpresa.strEmpresa` | Acrescenta o nome da empresa/unidade. |
| `includeUnit` | `vwAgenda.strUnidade` quando `useAgendaUnitAddress=true`; caso contrário usa `defaultUnitAddress` ou o fallback montado pelo worker | Acrescenta unidade/endereço ao corpo. |
| `formatTurnSchedule` | `vwAgenda.bolAtendeHoraMarcada` e `vwAgenda.strHora` | Formata horário/turno ou ordem de chegada. |
| `includeConfirmationButton` | `tblWhatsAppEnvio.intAgendaId` e `dbo.fncBase64_Encode` | Acrescenta botão de URL com token. |
| `syncAgendaWhatsappStatus` | `tblAgenda.intAgendaId`, `tblAgenda.bolWhatsAppEnviado` e `tblWhatsAppEnvio.intAgendaId` | Grava `S` no status da agenda após sucesso. |
| `testModeEnabled` | `vwAgenda.strAgenda` e `tblWhatsAppEnvio.strAgenda` | Restringe produção e envio pelo nome do paciente. |
| `skipPastAppointmentTime` | `vwAgenda.datAgendamento`, `vwAgenda.strHora` e `tblWhatsAppEnvio.datDataAlerta` | Impede confirmação/revalidação de compromissos passados. |
| Bloqueio de presença confirmada | `tblAgenda.bolConfirmado` e `tblAgenda.datConfirmacao` | Impede a segunda mensagem quando a presença já foi confirmada ou atendida. |

`useTicketOpenForIsClosed`, normalização do nono dígito, horários comerciais e datas de liberação não exigem colunas adicionais no banco.

## `dbo.tblWhatsAppEnvio`

Todas estas colunas são necessárias. O produtor escreve as 14 colunas de snapshot/estado, e o SQL usa a identidade no `OUTPUT`, ordenação e deduplicação.

| Coluna | Tipo de referência | Nulo/default | Classificação e uso |
| --- | --- | --- | --- |
| `intWhatsAppEnvioId` | `int IDENTITY` | `NOT NULL`, PK | Identificador, atualização, ordenação e escolha do item mais recente. |
| `strTipo` | `varchar(20)` | `NULL` | Produtor grava `AgendaInicio`; seleção aceita `AgendaInicio` e `agendainicio`. |
| `bolEnviado` | `varchar(1)` | `NULL` | Pendência do novo agendamento; sucesso grava `S`. |
| `bolMensagemErro` | `bit` | `NOT NULL DEFAULT 0` | Bloqueia nova tentativa automática após erro. |
| `bolConfirma` | `char(1)` | `NOT NULL DEFAULT 'N'` | Pendência/deduplicação da confirmação; sucesso grava `S`. |
| `strTelefone` | `varchar(20)` | `NULL` | Destinatário sem o prefixo `55`; também é corrigido na revalidação. |
| `intEmpresaId` | `int` | `NULL` | Snapshot produzido a partir da agenda. |
| `datWhatsAppEnvio` | `datetime` | `NULL` | Data de criação da fila (`GETDATE()`). |
| `datDataAlerta` | `datetime` | `NULL` | Data/hora exata do compromisso; janela, ordenação, join lógico e deduplicação. |
| `intAgendaId` | `int` | `NULL` | Join com agenda e chave do compromisso. |
| `strAgenda` | `varchar(800)` | `NULL` | Snapshot do paciente; filtro de teste e detecção de divergência. |
| `intClienteId` | `int` | `NULL` | Identidade preferencial do paciente na deduplicação. |
| `intAtendimentoId` | `int` | `NULL` | Snapshot criado pelo produtor. |
| `strProfissional` | `varchar(100)` | `NULL` | Snapshot e detecção de divergência. |
| `strProcedimento` | `varchar(6000)` | `NULL` | Recurso opcional `includeProcedure`; tem preferência sobre a especialidade da view. A coluna ainda é citada nos SELECTs. |

Regras de valor importantes:

- estados usam `S`/`N`, exceto `bolMensagemErro`, que é `bit`;
- `strTelefone` deve conter ao menos 10 dígitos e normalmente não deve conter `55`, pois as consultas acrescentam esse prefixo;
- `datDataAlerta` deve ser igual à combinação `vwAgenda.datAgendamento + vwAgenda.strHora`; divergência impede o envio;
- o produtor evita duplicidade por agenda, data/hora e cliente; sem `intClienteId`, usa paciente + telefone.

## `dbo.vwAgenda`

A view deve expor todas as colunas abaixo com nomes compatíveis. O ROBOZAP não depende das demais colunas que a view real possa conter.

| Coluna | Tipo de referência | Nulo | Classificação e uso |
| --- | --- | --- | --- |
| `intAgendaId` | `int` | não | Identifica o slot e liga a fila à agenda. |
| `strAgenda` | `varchar(150)` | sim | Nome do paciente, filtro de teste e revalidação. |
| `strProfissional` | `varchar(150)` | sim | Template, snapshot e revalidação. |
| `strTelefone` | `varchar(50)` | sim | Telefone alternativo. |
| `strCelular` | `varchar(20)` | sim | Fonte preferencial quando possui pelo menos 10 dígitos. |
| `bolBloqueado` | `varchar(1)` | sim | `S` ou `1` impede produção e envio. |
| `datAgendamento` | `datetime` | não | Data do compromisso e filtros de janela. |
| `strHora` | `varchar(5)` | sim | Hora `HH:mm`; compõe o instante do compromisso. |
| `strEmpresa` | `varchar(150)` | sim | Recurso opcional `includeCompany` e fallback do nome da unidade. |
| `intEmpresaId` | `int` | não | Núcleo do snapshot/join; também atende `includeCompany`. |
| `intClienteId` | `int` | sim | Snapshot e deduplicação. |
| `intAtendimentoId` | `int` | sim | Snapshot da fila. |
| `strProcedimento` | `varchar(150)` | sim | Recurso opcional `includeProcedure`; é gravado na fila pelo produtor. |
| `strEspecialidadeMedica` | `varchar(400)` | sim | Recurso opcional `includeProcedure`; fallback quando o procedimento da fila está vazio. |
| `bolAtendeHoraMarcada` | `varchar(1)` | sim | Recurso opcional `formatTurnSchedule`. |
| `strUnidade` | `varchar(150)` | sim | Recurso opcional `includeUnit` + `useAgendaUnitAddress`. |

Requisitos de conteúdo da view:

- deve haver no máximo uma linha por `intAgendaId`; múltiplas linhas fazem a revalidação retornar `agenda_duplicada`;
- `strAgenda` não pode estar vazio para itens enviáveis;
- pelo menos `strCelular` ou `strTelefone`, depois da limpeza, deve ter 10 dígitos;
- `datAgendamento` deve representar a data e `strHora` deve ser convertível para formar o mesmo `datetime` armazenado na fila;
- telefones podem conter espaços, hífen, parênteses, `+`, ponto e barra; esses caracteres são removidos pelo SQL.

## `dbo.tblAgenda`

Somente estas cinco colunas são referenciadas pelo ROBOZAP. Uma tabela de agenda completa normalmente possui outras colunas exigidas pelo sistema clínico de origem.

| Coluna | Tipo de referência | Nulo | Classificação e uso |
| --- | --- | --- | --- |
| `intAgendaId` | `int` | não | Join com fila/view. Deve identificar o registro correspondente. |
| `intUnidadeId` | `int` | sim | Recurso opcional `includeCompany`; join com `tblEmpresa` para resolver a unidade. O join existe no SQL em todos os cenários. |
| `bolWhatsAppEnviado` | `varchar(1)` | sim | Recurso opcional `syncAgendaWhatsappStatus`; recebe `S`. A coluna aparece no batch SQL mesmo quando a flag vale `false`. |
| `bolConfirmado` | `char(1)` | sim | Estado clínico. Valores `A` ou `S` bloqueiam a segunda mensagem. |
| `datConfirmacao` | `datetime` | sim | Quando preenchida, bloqueia a segunda mensagem independentemente do estado. |

`tblWhatsAppEnvio.bolConfirma` informa que o Robozap já enviou a segunda mensagem. Ele não substitui `tblAgenda.bolConfirmado`/`datConfirmacao`, que representam a confirmação clínica.

## `dbo.tblEmpresa`

| Coluna | Tipo de referência | Nulo | Classificação e uso |
| --- | --- | --- | --- |
| `intEmpresaId` | `int` | não | Recurso opcional `includeCompany`; join pela empresa da view ou unidade de `tblAgenda`. Os joins existem em todos os cenários. |
| `strEmpresa` | `varchar(150)` | sim | Recurso opcional `includeCompany`; nome enviado no payload. |

Para novo agendamento, o código atual pode usar `vwAgenda.strUnidade`. Para confirmação, a consulta fornece um endereço literal e `defaultUnitAddress` pode sobrescrevê-lo. Campos físicos de endereço da empresa não são consultados atualmente.

## Colunas de extensão possíveis

Schemas compatíveis podem expor campos adicionais de unidade e endereço. Eles são úteis para eliminar endereço literal e montar o sétimo parâmetro dinamicamente, mas **não são consumidos pelo código atual**.

| Objeto possível | Coluna | Tipo de referência | Uso que pode ser implementado |
| --- | --- | --- | --- |
| `dbo.vwAgenda` | `intUnidadeId` | `int` | Identificar diretamente a unidade do compromisso. |
| `dbo.vwAgenda` | `strEnderecoUnidade` | `varchar(200)` | Logradouro da unidade. |
| `dbo.vwAgenda` | `strNumeroUnidade` | `varchar(10)` | Número da unidade. |
| `dbo.vwAgenda` | `strBairroUnidade` | `varchar(150)` | Bairro da unidade. |
| `dbo.vwAgenda` | `strTelefoneUnidade` | `varchar(50)` | Contato da unidade, se o template passar a utilizá-lo. |
| `dbo.tblEmpresa` | `strEndereco` | `varchar(200)` | Fallback de logradouro pelo cadastro da empresa/unidade. |
| `dbo.tblEmpresa` | `strNumero` | `varchar(10)` | Fallback de número. |
| `dbo.tblEmpresa` | `strComplemento` | `varchar(150)` | Complemento do endereço. |
| `dbo.tblEmpresa` | `strBairro` | `varchar(150)` | Fallback de bairro. |
| `dbo.tblEmpresa` | `intCidadeId` | `int` | Liga a uma tabela de cidades, caso ela faça parte da integração. |
| `dbo.tblEmpresa` | `strEstado` | `char(2)` | UF. |
| `dbo.tblEmpresa` | `strCEP` | `varchar(10)` | CEP. |

Para usar esses campos, é necessário alterar os SELECTs de `messageRepository.js` e o mapeamento de `montarDadosFormatados()` em `src/index.js`. Apenas criar as colunas não muda o payload.

## `dbo.fncBase64_Encode`

Assinatura de referência:

```sql
dbo.fncBase64_Encode(@string varchar(max)) RETURNS varchar(max)
```

O argumento atual concatena `intAgendaId`, hífen e `GETDATE()` formatado. O resultado é passado como parâmetro dinâmico do botão de URL quando `includeConfirmationButton=true`.

Embora o botão seja opcional, as duas consultas de envio selecionam `dbo.fncBase64_Encode(...) AS Link`; portanto a função precisa existir e o usuário deve poder executá-la/selecioná-la em todos os cenários atuais.

## Escritas realizadas

| Momento | Escrita |
| --- | --- |
| Produção | `INSERT` das colunas listadas em `tblWhatsAppEnvio`. |
| Telefone mudou | `UPDATE tblWhatsAppEnvio SET strTelefone = ...`. |
| Novo agendamento enviado | `bolEnviado='S', bolMensagemErro=0`. |
| Confirmação enviada | `bolConfirma='S', bolEnviado='S', bolMensagemErro=0`. |
| Erro HTTP/processamento | `bolMensagemErro=1`. |
| Sincronização opcional | `UPDATE tblAgenda SET bolWhatsAppEnviado='S'`. |

Todas são precedidas por:

```sql
SET CONTEXT_INFO 0x123456;
```

Esse valor provavelmente identifica a origem para triggers do banco. Uma instalação compatível deve aceitar `SET CONTEXT_INFO`; se possuir triggers, deve validar o significado desse marcador.

## Permissões mínimas

Adapte o usuário abaixo ao ambiente:

```sql
GRANT SELECT ON dbo.vwAgenda TO [usuario_robozap];
GRANT SELECT ON dbo.tblWhatsAppEnvio TO [usuario_robozap];
GRANT INSERT, UPDATE ON dbo.tblWhatsAppEnvio TO [usuario_robozap];
GRANT SELECT ON dbo.tblAgenda TO [usuario_robozap];
GRANT UPDATE ON dbo.tblAgenda TO [usuario_robozap];
GRANT SELECT ON dbo.tblEmpresa TO [usuario_robozap];
GRANT SELECT ON dbo.fncBase64_Encode TO [usuario_robozap];
```

Se `syncAgendaWhatsappStatus=false`, o `UPDATE` de `tblAgenda` não é executado. Ainda assim, `SELECT` é necessário por causa dos joins.

## Índices recomendados

`tblWhatsAppEnvio.intWhatsAppEnvioId` deve possuir chave primária/índice único. Para bases novas, valide planos de execução antes de criar outros índices. Os acessos do worker se beneficiam de índices equivalentes a:

- `tblWhatsAppEnvio (intAgendaId, datDataAlerta, intClienteId, intWhatsAppEnvioId)` incluindo estados, telefone e snapshots;
- `tblWhatsAppEnvio (bolMensagemErro, bolEnviado, strTipo, datDataAlerta)` para novo agendamento;
- `tblWhatsAppEnvio (bolMensagemErro, bolConfirma, datDataAlerta)` para confirmação;
- `tblAgenda (intAgendaId)` e `tblEmpresa (intEmpresaId)`;
- índices nas tabelas-base que permitam à `vwAgenda` localizar `intAgendaId` e filtrar `datAgendamento`.

Não há um índice universal ideal: volume, seletividade da view e índices existentes precisam ser analisados no SQL Server.

## Validação rápida do contrato

Esta consulta lista ausências sem alterar o banco:

```sql
DECLARE @required TABLE (obj sysname, col sysname);

INSERT INTO @required (obj, col) VALUES
('tblWhatsAppEnvio','intWhatsAppEnvioId'),
('tblWhatsAppEnvio','strTipo'),
('tblWhatsAppEnvio','bolEnviado'),
('tblWhatsAppEnvio','bolMensagemErro'),
('tblWhatsAppEnvio','bolConfirma'),
('tblWhatsAppEnvio','strTelefone'),
('tblWhatsAppEnvio','intEmpresaId'),
('tblWhatsAppEnvio','datWhatsAppEnvio'),
('tblWhatsAppEnvio','datDataAlerta'),
('tblWhatsAppEnvio','intAgendaId'),
('tblWhatsAppEnvio','strAgenda'),
('tblWhatsAppEnvio','intClienteId'),
('tblWhatsAppEnvio','intAtendimentoId'),
('tblWhatsAppEnvio','strProfissional'),
('tblWhatsAppEnvio','strProcedimento'),
('tblAgenda','intAgendaId'),
('tblAgenda','intUnidadeId'),
('tblAgenda','bolWhatsAppEnviado'),
('tblAgenda','bolConfirmado'),
('tblAgenda','datConfirmacao'),
('tblEmpresa','intEmpresaId'),
('tblEmpresa','strEmpresa'),
('vwAgenda','intAgendaId'),
('vwAgenda','strAgenda'),
('vwAgenda','strProfissional'),
('vwAgenda','strTelefone'),
('vwAgenda','strCelular'),
('vwAgenda','bolBloqueado'),
('vwAgenda','datAgendamento'),
('vwAgenda','strHora'),
('vwAgenda','strEmpresa'),
('vwAgenda','intEmpresaId'),
('vwAgenda','intClienteId'),
('vwAgenda','intAtendimentoId'),
('vwAgenda','strProcedimento'),
('vwAgenda','strEspecialidadeMedica'),
('vwAgenda','bolAtendeHoraMarcada'),
('vwAgenda','strUnidade');

SELECT r.obj, r.col
FROM @required r
LEFT JOIN sys.objects o ON o.name = r.obj AND SCHEMA_NAME(o.schema_id) = 'dbo'
LEFT JOIN sys.columns c ON c.object_id = o.object_id AND c.name = r.col
WHERE c.column_id IS NULL
ORDER BY r.obj, r.col;

IF OBJECT_ID('dbo.fncBase64_Encode') IS NULL
    SELECT 'dbo.fncBase64_Encode' AS objeto_ausente;
```

Resultado vazio significa que os nomes existem; ainda é necessário validar tipos, permissões, conteúdo da view, triggers e conectividade.
