# Banco de Dados do ROBOZAP

Este documento descreve o schema mínimo necessário para o funcionamento completo do ROBOZAP: painel de fila, produtor, novo agendamento, confirmação, botão por URL, revalidação antes do envio e sincronização opcional de status.

O levantamento foi feito de duas formas:

- auditoria de todas as consultas em `src/repositories/messageRepository.js`;
- leitura dos metadados do banco `BIODATA_IMAGEMCOR` em 20/07/2026, sem leitura de dados clínicos e sem alterações.

Os tipos e tamanhos abaixo refletem a ImagemCor. Isto é o contrato do ROBOZAP, não uma cópia do schema completo do sistema Biodata: colunas que o restante do sistema clínico exige, mas que o ROBOZAP não acessa, estão fora do escopo.

## Objetos obrigatórios

| Objeto | Tipo | Obrigatório | Papel |
| --- | --- | --- | --- |
| `dbo.tblWhatsAppEnvio` | tabela | sim | Fila, snapshot e estado dos envios. |
| `dbo.vwAgenda` | view | sim | Dados atuais usados para produzir e revalidar a fila. |
| `dbo.tblAgenda` | tabela | sim | Resolve unidade; recebe status se a sincronização estiver ligada. |
| `dbo.tblEmpresa` | tabela | sim | Resolve o nome da empresa/unidade. |
| `dbo.fncBase64_Encode` | função escalar | sim no código atual | Gera o token usado no link de confirmação. É chamada mesmo quando o botão está desativado. |

## `dbo.tblWhatsAppEnvio`

Todas estas colunas são necessárias. O produtor escreve as 14 colunas de snapshot/estado, e o SQL usa a identidade no `OUTPUT`, ordenação e deduplicação.

| Coluna | Tipo observado | Nulo/default | Uso obrigatório |
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
| `strProcedimento` | `varchar(6000)` | `NULL` | Procedimento; tem preferência sobre a especialidade da view. |

Regras de valor importantes:

- estados usam `S`/`N`, exceto `bolMensagemErro`, que é `bit`;
- `strTelefone` deve conter ao menos 10 dígitos e normalmente não deve conter `55`, pois as consultas acrescentam esse prefixo;
- `datDataAlerta` deve ser igual à combinação `vwAgenda.datAgendamento + vwAgenda.strHora`; divergência impede o envio;
- o produtor evita duplicidade por agenda, data/hora e cliente; sem `intClienteId`, usa paciente + telefone.

## `dbo.vwAgenda`

A view deve expor todas as colunas abaixo com nomes compatíveis. O ROBOZAP não depende das demais colunas que a view real possa conter.

| Coluna | Tipo observado | Nulo | Uso obrigatório |
| --- | --- | --- | --- |
| `intAgendaId` | `int` | não | Identifica o slot e liga a fila à agenda. |
| `strAgenda` | `varchar(150)` | sim | Nome do paciente, filtro de teste e revalidação. |
| `strProfissional` | `varchar(150)` | sim | Template, snapshot e revalidação. |
| `strTelefone` | `varchar(50)` | sim | Telefone alternativo. |
| `strCelular` | `varchar(20)` | sim | Fonte preferencial quando possui pelo menos 10 dígitos. |
| `bolBloqueado` | `varchar(1)` | sim | `S` ou `1` impede produção e envio. |
| `datAgendamento` | `datetime` | não | Data do compromisso e filtros de janela. |
| `strHora` | `varchar(5)` | sim | Hora `HH:mm`; compõe o instante do compromisso. |
| `strEmpresa` | `varchar(150)` | sim | Nome principal/fallback da empresa. |
| `intEmpresaId` | `int` | não | Snapshot e join com `tblEmpresa`. |
| `intClienteId` | `int` | sim | Snapshot e deduplicação. |
| `intAtendimentoId` | `int` | sim | Snapshot da fila. |
| `strProcedimento` | `varchar(150)` | sim | Procedimento gravado na fila pelo produtor. |
| `strEspecialidadeMedica` | `varchar(400)` | sim | Fallback quando `strProcedimento` da fila está vazio. |
| `bolAtendeHoraMarcada` | `varchar(1)` | sim | Formatação opcional por horário/turno. |
| `strUnidade` | `varchar(150)` | sim | Texto usado quando `useAgendaUnitAddress=true`. |

Requisitos de conteúdo da view:

- deve haver no máximo uma linha por `intAgendaId`; múltiplas linhas fazem a revalidação retornar `agenda_duplicada`;
- `strAgenda` não pode estar vazio para itens enviáveis;
- pelo menos `strCelular` ou `strTelefone`, depois da limpeza, deve ter 10 dígitos;
- `datAgendamento` deve representar a data e `strHora` deve ser convertível para formar o mesmo `datetime` armazenado na fila;
- telefones podem conter espaços, hífen, parênteses, `+`, ponto e barra; esses caracteres são removidos pelo SQL.

## `dbo.tblAgenda`

Somente estas três colunas são exigidas pelo ROBOZAP. A tabela real da ImagemCor possui outras colunas por exigência do sistema clínico.

| Coluna | Tipo observado | Nulo | Uso obrigatório |
| --- | --- | --- | --- |
| `intAgendaId` | `int` | não | Join com fila/view. Deve identificar o registro correspondente. |
| `intUnidadeId` | `int` | sim | Join opcional com `tblEmpresa` para resolver a unidade. |
| `bolWhatsAppEnviado` | `varchar(1)` | sim | Recebe `S` quando `syncAgendaWhatsappStatus=true`. |

## `dbo.tblEmpresa`

| Coluna | Tipo observado | Nulo | Uso obrigatório |
| --- | --- | --- | --- |
| `intEmpresaId` | `int` | não | Join tanto pela empresa da view quanto pela unidade de `tblAgenda`. |
| `strEmpresa` | `varchar(150)` | sim | Nome enviado no payload quando habilitado. |

O endereço físico de `tblEmpresa` não é consultado pelo código atual. Para novo agendamento, a unidade pode vir de `vwAgenda.strUnidade`; para confirmação, a consulta SQL fornece um endereço literal e `defaultUnitAddress` pode sobrescrevê-lo.

## `dbo.fncBase64_Encode`

Assinatura observada:

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

O banco ImagemCor já possui PK em `tblWhatsAppEnvio.intWhatsAppEnvioId`. Para bases novas, valide planos de execução antes de criar índices. Os acessos do worker se beneficiam de índices equivalentes a:

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
