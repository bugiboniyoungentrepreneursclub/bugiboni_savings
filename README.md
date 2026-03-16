# Bugiboni Young Entrepreneurs Savings Management System PWA

A Progressive Web App for managing savings records with role-based access control.

## Features

- 🔐 Secure login with role-based dashboards
- 💰 Deposit recording with automatic balance calculation
- 📱 WhatsApp integration for payment confirmations
- 📊 Individual and group reports
- 👥 User management (Admin/Chairperson)
- 📈 Transaction history and audit trail
- 📱 Installable as PWA on Android
- 🔄 Offline support with service worker

## User Roles

- **Admin**: System configuration, user management, audit viewing
- **Chairperson**: User management, reports viewing
- **Treasurer**: Record deposits, view all transactions
- **Leadership**: View member lists and summaries
- **Member**: View personal balance and history

## Tech Stack

- Frontend: HTML, CSS, JavaScript (PWA)
- Backend: Vercel Serverless Functions (Node.js)
- Storage: GitHub repository (JSON files)
- Authentication: JWT + bcrypt

## Deployment Instructions

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/bugiboni-savings-pwa.git
cd bugiboni-savings-pwa
