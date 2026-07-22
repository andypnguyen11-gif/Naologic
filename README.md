This project is a full-stack manufacturing scheduling and planning app for managing work orders, production readiness, and user access across work centers.

## Live Deployment

The app is deployed on Railway:

- **Frontend (app):** https://frontend-production-fe74.up.railway.app
- **API:** https://api-production-01a0.up.railway.app

### Admin test account

Sign in at https://frontend-production-fe74.up.railway.app/login with:

- **Email:** `naologic.admin@example.com`
- **Password:** `NaoAdmin123!`

This account has the **Admin** role, so it can create, edit, and delete work orders and access the admin user-management screen. You can also create your own account via the signup page.

It includes:

- an Angular frontend for work-order scheduling, planning analysis, authentication, and admin flows
- a C# ASP.NET Core API for retrieving and managing work-order, planning, auth, and admin data
- a SQL Server database for persisting the manufacturing data shown in the UI

The frontend allows users to:

- sign up, log in, and access authenticated application routes
- view work orders by day, week, or month
- create, edit, and delete work orders
- see work orders grouped by work center
- validate scheduling conflicts in the UI
- open a planning dashboard with product and target quantity filters
- review buildability, shortages, projected ready days, and component gap detail through summary cards, charts, and tables
- access an admin screen for user management when authorized

The backend is responsible for:

- serving work-center and work-order data to the frontend
- handling create, update, and delete work-order operations
- exposing planning data for component gap analysis based on bill of materials, inventory, and work-center data
- handling authentication and authorization for application users
- supporting admin user-management operations
- persisting application data in SQL Server instead of browser localStorage

The database layer includes:

- a `WorkCenters` table
- a `WorkOrders` table
- planning-related tables such as bill of materials, parts, and inventory
- user/account data used for authentication and admin access
- SQL setup and seed scripts that create the schema and load the sample data
