# Login e recuperação — proposta de Diego21/9

Complementa ARCHITECTURE-NOTES.md, que já prevê Google/Apple e vínculo explícito de proprietário por convite.

Direção solicitada: experiência simples; login Google ou Apple; evitar aplicativo autenticador obrigatório para hóspedes/proprietários. Diego propôs código por e-mail e incentivo a cadastrar mais de um e-mail, escolhendo entre endereços previamente verificados para receber o código. Depois perguntou se SMS seria melhor: canal ainda em avaliação, não decisão final nem alteração de proteção existente.

Separar login, verificação adicional e recuperação. E-mail alternativo pode ajudar recuperação, mas não garante mais segurança e amplia os caminhos de acesso. Proposta técnica Lia: validar cada endereço; proteger inclusão/troca/remoção com reautenticação e avisos; limitar tentativas, expiração e uso único; não permitir que alguém escolha um endereço novo na tela de desafio. LoginGoogle e código na mesma conta não são necessariamente fatores independentes. SMS tem risco de troca fraudulenta de chip e não resiste a phishing.

Avaliar passkeys (biometria/PIN do aparelho) como opção simples de verificação forte, com recuperação cuidadosamente desenhada; recomendação Lia, não escolha aprovada por Diego. Não exigir desafio redundante em toda visita sem avaliar risco. Acesso a imóveis continua por associação explícita, nunca só por e-mail/telefone. Nada implementado nesta nota.

Fonte técnica consultada21/9: https://pages.nist.gov/800-63-4/sp800-63b.html . NIST não aceita e-mail como autenticador fora de banda e trata PSTN/SMS como restrito; não declarar conformidade MFA baseada em e-mail.
