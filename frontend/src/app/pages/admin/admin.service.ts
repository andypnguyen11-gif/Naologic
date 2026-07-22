import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AdminUser, UpdateUserRoleItemRequest } from './admin.models';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = `${environment.apiBaseUrl}/admin`;

  getUsers(): Observable<AdminUser[]> {
    return this.http.get<AdminUser[]>(`${this.apiBaseUrl}/users`);
  }

  updateUserRoles(updates: UpdateUserRoleItemRequest[]): Observable<void> {
    return this.http.put<void>(`${this.apiBaseUrl}/users/update-roles`, { updates });
  }
}
