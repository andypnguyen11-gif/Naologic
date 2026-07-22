import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { AuthResponse, AuthUser, LoginRequest, SignupRequest } from './auth.models';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiBaseUrl = `${environment.apiBaseUrl}/auth`;
  private readonly storageKey = 'naologic.auth';
  private readonly authState = signal<AuthResponse | null>(this.readStoredSession());

  readonly currentUser = computed<AuthUser | null>(() => this.authState()?.user ?? null);
  readonly token = computed<string | null>(() => this.authState()?.token ?? null);
  readonly isAuthenticated = computed<boolean>(() => !!this.authState()?.token);
  readonly canManageWorkOrders = computed<boolean>(() => {
    const role = this.currentUser()?.role;
    return role === 'Admin' || role === 'Planner';
  });
  readonly isAdmin = computed<boolean>(() => this.currentUser()?.role === 'Admin');

  login(payload: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiBaseUrl}/login`, payload).pipe(
      tap((response) => this.persistSession(response))
    );
  }

  signup(payload: SignupRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiBaseUrl}/signup`, payload).pipe(
      tap((response) => this.persistSession(response))
    );
  }

  logout(): void {
    this.authState.set(null);
    this.clearStoredSession();
    void this.router.navigate(['/login']);
  }

  private persistSession(response: AuthResponse): void {
    this.authState.set(response);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.storageKey, JSON.stringify(response));
    }
  }

  private readStoredSession(): AuthResponse | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return null;
      }

      return JSON.parse(raw) as AuthResponse;
    } catch {
      return null;
    }
  }

  private clearStoredSession(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.storageKey);
    }
  }
}
