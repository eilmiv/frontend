import { Injectable } from "@angular/core";
import { Actions, ofType, createEffect } from "@ngrx/effects";
import { ADAuthService } from "users/adauth.service";
import {
  LoopBackAuth,
  UserApi,
  UserIdentityApi,
  SDKToken,
  User,
  UserIdentity
} from "shared/sdk";
import { Router } from "@angular/router";
import * as fromActions from "state-management/actions/user.actions";
import {
  map,
  switchMap,
  catchError,
  filter,
  tap,
  withLatestFrom,
  distinctUntilChanged,
  mergeMap,
  takeWhile
} from "rxjs/operators";
import { of } from "rxjs";
import { MessageType } from "state-management/models";
import { Store, select } from "@ngrx/store";
import {
  getColumns,
  getCurrentUser
} from "state-management/selectors/user.selectors";
import { setDatasetsLimitFilterAction } from "state-management/actions/datasets.actions";
import { setJobsLimitFilterAction } from "state-management/actions/jobs.actions";

@Injectable()
export class UserEffects {
  user$ = this.store.pipe(select(getCurrentUser));
  columns$ = this.store.pipe(select(getColumns));

  login$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.loginAction),
      map(action => action.form),
      map(({ username, password, rememberMe }) =>
        fromActions.activeDirLoginAction({ username, password, rememberMe })
      )
    )
  );

  adLogin$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.activeDirLoginAction),
      switchMap(({ username, password, rememberMe }) =>
        this.activeDirAuthService.login(username, password).pipe(
          switchMap(({ body }) => [
            fromActions.activeDirLoginSuccessAction(),
            fromActions.fetchUserAction({ adLoginResponse: body })
          ]),
          catchError(() =>
            of(
              fromActions.activeDirLoginFailedAction({
                username,
                password,
                rememberMe
              })
            )
          )
        )
      )
    )
  );

  fetchUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.fetchUserAction),
      switchMap(({ adLoginResponse }) => {
        const token = new SDKToken({
          id: adLoginResponse.access_token,
          userId: adLoginResponse.userId
        });
        this.loopBackAuth.setToken(token);
        return this.userApi.findById(adLoginResponse.userId).pipe(
          switchMap((user: User) => [
            fromActions.fetchUserCompleteAction(),
            fromActions.loginCompleteAction({
              user,
              accountType: "external"
            })
          ]),
          catchError(() => of(fromActions.fetchUserFailedAction()))
        );
      })
    )
  );

  loginRedirect$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.activeDirLoginFailedAction),
      map(({ username, password, rememberMe }) =>
        fromActions.funcLoginAction({ username, password, rememberMe })
      )
    )
  );

  funcLogin$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.funcLoginAction),
      switchMap(({ username, password, rememberMe }) =>
        this.userApi.login({ username, password, rememberMe }).pipe(
          switchMap(({ user }) => [
            fromActions.funcLoginSuccessAction(),
            fromActions.loginCompleteAction({
              user,
              accountType: "functional"
            })
          ]),
          catchError(() => of(fromActions.funcLoginFailedAction()))
        )
      )
    )
  );

  loginFailed$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        fromActions.fetchUserFailedAction,
        fromActions.funcLoginFailedAction
      ),
      map(() => fromActions.loginFailedAction())
    )
  );

  loginFailedMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.loginFailedAction),
      map(() =>
        fromActions.showMessageAction({
          message: {
            content: "Could not log in. Check your username and password.",
            type: MessageType.Error,
            duration: 5000
          }
        })
      )
    )
  );

  logout$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.logoutAction),
      filter(() => this.userApi.isAuthenticated()),
      switchMap(() =>
        this.userApi.logout().pipe(
          map(() => fromActions.logoutCompleteAction()),
          catchError(() => of(fromActions.logoutFailedAction()))
        )
      )
    )
  );

  logoutNavigate$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(fromActions.logoutCompleteAction),
        tap(() => this.router.navigate([""]))
      ),
    { dispatch: false }
  );

  fetchCurrentUser$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.fetchCurrentUserAction),
      switchMap(() =>
        this.userApi.getCurrent().pipe(
          switchMap(user => [
            fromActions.fetchCurrentUserCompleteAction({ user }),
            fromActions.fetchUserIdentityAction({ id: user.id }),
            fromActions.fetchUserSettingsAction({ id: user.id })
          ]),
          catchError(() => of(fromActions.fetchCurrentUserFailedAction()))
        )
      )
    )
  );

  fetchUserIdentity$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.fetchUserIdentityAction),
      switchMap(({ id }) =>
        this.userIdentityApi.findOne({ where: { userId: id } }).pipe(
          map((userIdentity: UserIdentity) =>
            fromActions.fetchUserIdentityCompleteAction({ userIdentity })
          ),
          catchError(() => of(fromActions.fetchUserIdentityFailedAction()))
        )
      )
    )
  );

  fetchUserSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.fetchUserSettingsAction),
      switchMap(({ id }) =>
        this.userApi.getSettings(id, null).pipe(
          map(userSettings =>
            fromActions.fetchUserSettingsCompleteAction({ userSettings })
          ),
          catchError(() => of(fromActions.fetchUserSettingsFailedAction()))
        )
      )
    )
  );

  setLimitFilters$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.fetchUserSettingsCompleteAction),
      mergeMap(({ userSettings }) => [
        setDatasetsLimitFilterAction({ limit: userSettings.datasetCount }),
        setJobsLimitFilterAction({ limit: userSettings.jobCount })
      ])
    )
  );

  addCustomColumns$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.addCustomColumnsAction),
      withLatestFrom(this.columns$),
      distinctUntilChanged(),
      map(() => fromActions.addCustomColumnsCompleteAction())
    )
  );

  updateUserColumns$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        fromActions.selectColumnAction,
        fromActions.deselectColumnAction,
        fromActions.deselectAllCustomColumnsAction,
        fromActions.addCustomColumnsCompleteAction
      ),
      withLatestFrom(this.columns$),
      map(([action, columns]) => columns),
      map(columns =>
        fromActions.updateUserSettingsAction({ property: { columns } })
      )
    )
  );

  updateUserSettings$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.updateUserSettingsAction),
      withLatestFrom(this.user$),
      takeWhile(([action, user]) => !!user),
      switchMap(([{ property }, { id }]) =>
        this.userApi.updateSettings(id, property).pipe(
          map(userSettings =>
            fromActions.updateUserSettingsCompleteAction({ userSettings })
          ),
          catchError(() => of(fromActions.updateUserSettingsFailedAction()))
        )
      )
    )
  );

  fetchCatamelToken$ = createEffect(() =>
    this.actions$.pipe(
      ofType(fromActions.fetchCatamelTokenAction),
      switchMap(() =>
        of(this.userApi.getCurrentToken()).pipe(
          map(token => fromActions.fetchCatamelTokenCompleteAction({ token })),
          catchError(() => of(fromActions.fetchCatamelTokenFailedAction()))
        )
      )
    )
  );

  constructor(
    private actions$: Actions,
    private activeDirAuthService: ADAuthService,
    private loopBackAuth: LoopBackAuth,
    private router: Router,
    private store: Store<User>,
    private userApi: UserApi,
    private userIdentityApi: UserIdentityApi
  ) {}
}
