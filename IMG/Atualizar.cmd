@echo off
title Atualizacao Git

echo Executando git pull...
git pull

if %errorlevel% neq 0 (
    echo.
    echo Erro ao executar o git pull.
) else (
    echo.
    echo Repositorio atualizado com sucesso.
)

pause